/**
 * JSON renderer: 2-space pretty-print for application/json outputs.
 *
 * @category Render
 * @module json
 */

import type { RenderFragment } from "../../../schema/render-plan.ts";

/**
 * Render a JSON value as a 2-space indented `RenderFragment`.
 *
 * Produces a trailing empty line (one newline at end) consistent with
 * `serializeNotebook` output format.
 *
 * @param value - Any JSON-serializable value.
 * @returns `RenderFragment` with pretty-printed lines.
 * @spec-id europa.render.json.pretty
 */
export function renderJson(value: unknown): RenderFragment {
  const pretty = JSON.stringify(value, null, 2) + "\n";
  const lines = pretty.split("\n");
  return {
    lines,
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
    mdDecorations: [],
  };
}
