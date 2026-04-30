/**
 * RenderPlan builder: assembles a Notebook into a flat line buffer.
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

/**
 * Assemble a `RenderPlan` from a normalized `Notebook`.
 *
 * Each cell contributes:
 *   1. A header decoration line (`## [cell_type] id`)
 *   2. One line per source line (split on `\n`)
 *
 * The `cellMap` records the half-open buffer line range `[bufLineStart,
 * bufLineEnd)` for each cell so that the viewer can place markers and
 * handle navigation without re-parsing the rendered buffer.
 *
 * @param nb - Normalized notebook (all source fields are plain strings).
 * @param _caps - Host capabilities (reserved for output dispatch in later phases).
 * @returns A `RenderPlan` ready for `applyRenderPlan`.
 * @spec-id europa.render.builder.assemble
 */
export function buildRenderPlan(nb: Notebook, _caps: Capabilities): RenderPlan {
  const lines: string[] = [];
  const cellMap: RenderPlan["cellMap"] = [];
  const highlights: RenderPlan["highlights"] = [];

  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i];
    const bufLineStart = lines.length;

    lines.push(`## [${cell.cell_type}] ${cell.id}`);

    const sourceLines = cell.source ? cell.source.split("\n") : [];
    for (const line of sourceLines) {
      lines.push(line);
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
