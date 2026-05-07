/**
 * RenderPlan builder: assembles a Notebook into a flat line buffer.
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Notebook, Output } from "../../../schema/notebook.ts";
import type {
  BuildRenderPlanOpts,
  CellRange,
  RenderFragment,
  RenderPlan,
  SixelPlacement,
} from "../../../schema/render-plan.ts";
import { dispatchOutput } from "./dispatcher.ts";
import { renderMarkdown } from "./markdown.ts";

// Matches schema/config.ts and denops/europa/config.ts — when no opts are
// passed, the renderer behaves as if the user accepted Vim defaults.
const DEFAULT_MAX_OUTPUT_LINES = 100;
const DEFAULT_CELL_BORDER_CHARS = ["╭", "─", "╮", "╰", "╯"] as const;
const DEFAULT_CELL_BORDER_PADDING = 4;
const DEFAULT_CELL_BORDER_ALIGN = "left" as const;
// Reference width = length of "Out [NN]" (8). Ensures all cell types produce
// the same total border width regardless of label length differences.
const BORDER_REF_LABEL_WIDTH = 8;

function buildBorderLine(
  left: string,
  right: string,
  fill: string,
  label: string,
  leftFill: number,
  rightFill: number,
): string {
  return `${left}${fill.repeat(leftFill)} ${label} ${
    fill.repeat(rightFill)
  }${right}`;
}

function formatHeadBorder(
  cell: Notebook["cells"][number],
  chars: readonly string[],
  padding: number,
  align: "center" | "left",
): string {
  const tl = chars[0] ?? "╭";
  const h = chars[1] ?? "─";
  const tr = chars[2] ?? "╮";
  let label: string;
  if (cell.cell_type === "code") {
    label = `In [${cell.execution_count ?? " "}]`;
  } else if (cell.cell_type === "markdown") {
    label = "Md";
  } else {
    label = "Raw";
  }
  const extraFill = Math.max(0, BORDER_REF_LABEL_WIDTH - label.length);
  const [lf, rf] = align === "left"
    ? [0, padding * 2 + extraFill]
    : [padding, padding + extraFill];
  return buildBorderLine(tl, tr, h, label, lf, rf);
}

function formatMidBorder(
  cell: Notebook["cells"][number],
  chars: readonly string[],
  padding: number,
  align: "center" | "left",
): string {
  const h = chars[1] ?? "─";
  const bl = chars[3] ?? "╰";
  const br = chars[4] ?? "╯";
  const n = cell.cell_type === "code" ? (cell.execution_count ?? " ") : " ";
  const label = `Out [${n}]`;
  const extraFill = Math.max(0, BORDER_REF_LABEL_WIDTH - label.length);
  const [lf, rf] = align === "left"
    ? [0, padding * 2 + extraFill]
    : [padding, padding + extraFill];
  return buildBorderLine(bl, br, h, label, lf, rf);
}

/** Merge consecutive stream outputs of the same name (FR-012). */
export function mergeStreams(outputs: readonly Output[]): Output[] {
  const merged: Output[] = [];
  for (const out of outputs) {
    const prev = merged[merged.length - 1];
    if (
      out.output_type === "stream" &&
      prev?.output_type === "stream" &&
      prev.name === out.name
    ) {
      merged[merged.length - 1] = {
        ...prev,
        text: prev.text + out.text,
      };
    } else {
      merged.push(out);
    }
  }
  return merged;
}

/**
 * Append `lines` and `highlights` from a fragment onto the plan arrays,
 * adjusting highlight line numbers by the current line offset.
 */
function appendFragment(
  plan: { lines: string[]; highlights: RenderPlan["highlights"] },
  frag: RenderFragment,
): void {
  const offset = plan.lines.length;
  for (const line of frag.lines) plan.lines.push(line);
  for (const hl of frag.highlights) {
    plan.highlights.push({ ...hl, line: hl.line + offset });
  }
}

/**
 * Append a cell's outputs to the plan under a per-cell `maxLines` budget
 * (FR-051). Collects Sixel placements alongside fragments, adjusting their
 * buffer-line offset so the viewer can locate each image.
 *
 * Note on `outputIdx`: after `mergeStreams`, consecutive same-name stream
 * outputs are merged. The index `j` into the merged array is used as
 * `outputIdx` in image placeholders.
 */
function appendCellOutputs(
  plan: {
    lines: string[];
    highlights: RenderPlan["highlights"];
    sixelPlacements: SixelPlacement[];
  },
  outputs: readonly Output[],
  caps: Capabilities,
  mimePriority: string[],
  maxLines: number,
  cellIdx: number,
): void {
  const merged = mergeStreams(outputs);

  const items = merged.map((out, j) => {
    const sixel: SixelPlacement[] = [];
    const frag = dispatchOutput(out, caps, mimePriority, {
      cellIdx,
      outputIdx: j,
    }, sixel);
    return { frag, sixel };
  });

  const totalLines = items.reduce((n, x) => n + x.frag.lines.length, 0);

  if (totalLines <= maxLines) {
    for (const { frag, sixel } of items) {
      const offset = plan.lines.length;
      appendFragment(plan, frag);
      for (const sp of sixel) {
        plan.sixelPlacements.push({ ...sp, line: sp.line + offset });
      }
    }
    return;
  }

  const budget = maxLines - 1;
  let used = 0;
  for (const { frag, sixel } of items) {
    if (used >= budget) break;
    const room = budget - used;
    const offset = plan.lines.length;
    if (frag.lines.length <= room) {
      appendFragment(plan, frag);
      for (const sp of sixel) {
        plan.sixelPlacements.push({ ...sp, line: sp.line + offset });
      }
      used += frag.lines.length;
    } else {
      const truncated: RenderFragment = {
        ...frag,
        lines: frag.lines.slice(0, room),
        highlights: frag.highlights.filter((h) => h.line < room),
      };
      appendFragment(plan, truncated);
      for (const sp of sixel) {
        if (sp.line < room) {
          plan.sixelPlacements.push({ ...sp, line: sp.line + offset });
        }
      }
      used = budget;
      break;
    }
  }
  plan.lines.push(`[... truncated, ${totalLines - used} more lines]`);
}

/**
 * Assemble a `RenderPlan` from a normalized `Notebook`.
 *
 * Each cell contributes:
 *   1. A header decoration line
 *   2. Source lines
 *   3. Output fragments (code cells only), with consecutive streams merged
 *      and the *combined* outputs of the cell capped at `maxOutputLines`
 *      lines (FR-051) — including the truncation summary, when present
 *
 * The `cellMap` records the buffer line range `[bufLineStart, bufLineEnd)`
 * for each cell. The `cellRanges` field records the same range by `cellId`
 * for cursor restoration after structural mutations.
 *
 * When the notebook is empty, 8 guidance lines are emitted and `cellRanges`
 * is returned as `[]`.
 *
 * @param nb - Normalized notebook (all source fields are plain strings).
 * @param caps - Host capabilities used by `dispatchOutput`.
 * @param opts - Options including `maxOutputLines`, `mimePriority`,
 *   `cellBorderChars`, `cellBorderPadding`, and `cellBorderAlign`. The `Out`
 *   mid-border emitted between source and outputs is a structural line and is
 *   NOT counted against the `maxOutputLines` cap.
 * @returns A `RenderPlan` ready for `applyRenderPlan`.
 * @spec-id europa.render.builder.assemble
 * @spec-id europa.render.builder.cell-ranges
 * @spec-id europa.render.builder.empty-notebook-guidance
 * @spec-id europa.render.builder.cell-borders
 */
export function buildRenderPlan(
  nb: Notebook,
  caps: Capabilities,
  opts?: BuildRenderPlanOpts,
): RenderPlan {
  const maxOutputLines = opts?.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;
  const cellBorderChars = opts?.cellBorderChars ?? DEFAULT_CELL_BORDER_CHARS;
  const cellBorderPadding = opts?.cellBorderPadding ??
    DEFAULT_CELL_BORDER_PADDING;
  const cellBorderAlign = opts?.cellBorderAlign ?? DEFAULT_CELL_BORDER_ALIGN;
  const mimePriority = opts?.mimePriority ?? [
    "image/png",
    "image/jpeg",
    "application/json",
    "text/markdown",
    "text/html",
    "text/plain",
  ];

  const lines: string[] = [];
  const highlights: RenderPlan["highlights"] = [];
  const sixelPlacements: SixelPlacement[] = [];
  const cellMap: RenderPlan["cellMap"] = [];
  const cellRanges: CellRange[] = [];

  if (nb.cells.length === 0) {
    lines.push(
      "[Empty notebook]",
      "",
      "This notebook has no cells.",
      "",
      "Add a cell with one of:",
      "    :EuropaInsertCell code",
      "    :EuropaInsertCell markdown",
      "    :EuropaInsertCell raw",
    );
    return {
      lines,
      highlights,
      virtText: [],
      imagePlacements: [],
      sixelPlacements,
      clickables: [],
      cellMap,
      cellRanges,
    };
  }

  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i];
    const startLine = lines.length;
    const bufLineStart = startLine;

    lines.push(
      formatHeadBorder(
        cell,
        cellBorderChars,
        cellBorderPadding,
        cellBorderAlign,
      ),
    );

    const sourceLines = cell.source ? cell.source.split("\n") : [];
    for (const line of sourceLines) lines.push(line);

    if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
      // Mid-border is structural; push before appendCellOutputs so it is not
      // counted against the maxOutputLines cap.
      lines.push(
        formatMidBorder(
          cell,
          cellBorderChars,
          cellBorderPadding,
          cellBorderAlign,
        ),
      );
      appendCellOutputs(
        { lines, highlights, sixelPlacements },
        cell.outputs,
        caps,
        mimePriority,
        maxOutputLines,
        i,
      );
    } else if (cell.cell_type === "markdown") {
      // Markdown source is already included above as plain lines;
      // highlights from renderMarkdown are added here.
      const frag = renderMarkdown(cell.source ?? "");
      const offset = bufLineStart + 1; // +1 for the header line
      for (const hl of frag.highlights) {
        highlights.push({ ...hl, line: hl.line + offset });
      }
    }

    const bufLineEnd = lines.length;
    const endLine = lines.length - 1;
    cellMap.push({ cellIndex: i, bufLineStart, bufLineEnd });
    cellRanges.push({ cellId: cell.id, startLine, endLine });
  }

  return {
    lines,
    highlights,
    virtText: [],
    imagePlacements: [],
    sixelPlacements,
    clickables: [],
    cellMap,
    cellRanges,
  };
}
