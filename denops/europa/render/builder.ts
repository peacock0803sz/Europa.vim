/**
 * RenderPlan builder: assembles a Notebook into a flat line buffer.
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Notebook, Output } from "../../../schema/notebook.ts";
import type {
  RenderFragment,
  RenderPlan,
  SixelPlacement,
} from "../../../schema/render-plan.ts";
import { dispatchOutput } from "./dispatcher.ts";
import { renderMarkdown } from "./markdown.ts";

// Matches schema/config.ts and denops/europa/config.ts — when no opts are
// passed, the renderer behaves as if the user accepted Vim defaults.
const DEFAULT_MAX_OUTPUT_LINES = 100;

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
 * for each cell.
 *
 * @param nb - Normalized notebook (all source fields are plain strings).
 * @param caps - Host capabilities used by `dispatchOutput`.
 * @param opts - Options including `maxOutputLines` and `mimePriority`.
 * @returns A `RenderPlan` ready for `applyRenderPlan`.
 * @spec-id europa.render.builder.assemble
 */
export function buildRenderPlan(
  nb: Notebook,
  caps: Capabilities,
  opts?: {
    maxOutputLines?: number;
    mimePriority?: string[];
  },
): RenderPlan {
  const maxOutputLines = opts?.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;
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

  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i];
    const bufLineStart = lines.length;

    lines.push(`## [${cell.cell_type}] ${cell.id}`);

    const sourceLines = cell.source ? cell.source.split("\n") : [];
    for (const line of sourceLines) lines.push(line);

    if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
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
    cellMap.push({ cellIndex: i, bufLineStart, bufLineEnd });
  }

  return {
    lines,
    highlights,
    virtText: [],
    imagePlacements: [],
    sixelPlacements,
    clickables: [],
    cellMap,
  };
}
