/**
 * HTML renderer: tag stripping for text/html outputs (Phase 2).
 *
 * Phase 4 will add pandoc-based conversion. For Phase 2, a simple tag-strip
 * regex is sufficient.
 *
 * @category Render
 * @module html
 */

import type { RenderFragment } from "../../../schema/render-plan.ts";

/**
 * Strip HTML tags and return plain text as a `RenderFragment`.
 *
 * Uses `replace(/<[^>]+>/g, "")` — HTML entity decoding is deferred to Phase 4.
 *
 * @param html - Raw HTML string.
 * @returns `RenderFragment` with tags removed.
 * @spec-id europa.render.html.tag-strip
 */
export function renderHtml(html: string): RenderFragment {
  const stripped = html.replace(/<[^>]+>/g, "");
  const lines = stripped.split("\n");
  return {
    lines,
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
  };
}
