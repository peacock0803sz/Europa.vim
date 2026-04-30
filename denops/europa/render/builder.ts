/**
 * RenderPlan builder: assembles a Notebook into a flat line buffer.
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Notebook, Output } from "../../../schema/notebook.ts";
import type {
  Highlight,
  RenderFragment,
  RenderPlan,
} from "../../../schema/render-plan.ts";
import { dispatchOutput } from "./dispatcher.ts";
import { renderMarkdown } from "./markdown.ts";

const DEFAULT_MAX_OUTPUT_LINES = 1000;

/** Merge consecutive stream outputs of the same name (FR-012). */
function mergeStreams(outputs: readonly Output[]): Output[] {
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

/** Truncate a fragment to `maxLines` and append a summary line if needed (FR-051). */
function truncateFragment(
  frag: RenderFragment,
  maxLines: number,
): RenderFragment {
  if (frag.lines.length <= maxLines) return frag;
  const overflow = frag.lines.length - maxLines;
  const truncatedLines = [
    ...frag.lines.slice(0, maxLines),
    `[... truncated, ${overflow} more lines]`,
  ];
  const truncatedHighlights: Highlight[] = frag.highlights.filter(
    (h) => h.line < maxLines,
  );
  return { ...frag, lines: truncatedLines, highlights: truncatedHighlights };
}

/** Append all fields of a RenderFragment onto the given RenderPlan arrays. */
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
 * Assemble a `RenderPlan` from a normalized `Notebook`.
 *
 * Each cell contributes:
 *   1. A header decoration line
 *   2. Source lines
 *   3. Output fragments (code cells only), with consecutive streams merged
 *      and each output truncated to `maxOutputLines`
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
  const cellMap: RenderPlan["cellMap"] = [];

  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i];
    const bufLineStart = lines.length;

    lines.push(`## [${cell.cell_type}] ${cell.id}`);

    const sourceLines = cell.source ? cell.source.split("\n") : [];
    for (const line of sourceLines) lines.push(line);

    if (cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0) {
      const merged = mergeStreams(cell.outputs);
      for (const out of merged) {
        const raw = dispatchOutput(out, caps, mimePriority);
        const frag = truncateFragment(raw, maxOutputLines);
        appendFragment({ lines, highlights }, frag);
      }
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
    clickables: [],
    cellMap,
  };
}
