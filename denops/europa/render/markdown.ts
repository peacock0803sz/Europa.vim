/**
 * Markdown renderer: heading-level highlights only (Phase 2).
 *
 * Phase 2 applies only `EuropaCellMarkdown` to ATX heading lines (`# ` through
 * `###### `). Inline rendering (bold, italic, links) is deferred to Phase 4.
 *
 * @category Render
 * @module markdown
 */

import type { Highlight, RenderFragment } from "../../../schema/render-plan.ts";

const HEADING_RE = /^#{1,6} /;

/**
 * Render a markdown source string with heading highlights.
 *
 * Lines matching `^#{1,6} ` receive `EuropaCellMarkdown` highlight. All other
 * lines are included as plain text without highlights.
 *
 * @param source - Raw markdown source (may include newlines).
 * @returns `RenderFragment` with heading highlights applied.
 * @spec-id europa.render.markdown.heading-only
 */
export function renderMarkdown(source: string): RenderFragment {
  const lines = source.split("\n");
  const highlights: Highlight[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      highlights.push({
        hlGroup: "EuropaCellMarkdown",
        line: i,
        col: 0,
        endCol: -1,
      });
    }
  }

  return {
    lines,
    highlights,
    virtText: [],
    imagePlacements: [],
    clickables: [],
  };
}
