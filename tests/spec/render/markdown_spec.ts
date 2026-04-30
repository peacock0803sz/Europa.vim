/**
 * BDD specs for renderMarkdown — heading-only highlight (Phase 2).
 *
 * @spec-id europa.render.markdown.heading-only
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { renderMarkdown } from "../../../denops/europa/render/markdown.ts";

describe("renderMarkdown", () => {
  it("applies EuropaCellMarkdown highlight to h1 lines", () => {
    const frag = renderMarkdown("# Title\nsome paragraph");
    assertExists(frag.highlights);
    const hlGroups = frag.highlights.map((h) => h.hlGroup);
    assertEquals(hlGroups.some((g) => g === "EuropaCellMarkdown"), true);
  });

  it("applies highlight to all heading levels h1-h6", () => {
    const source = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6";
    const frag = renderMarkdown(source);
    const headingLines = frag.highlights.filter(
      (h) => h.hlGroup === "EuropaCellMarkdown",
    );
    assertEquals(headingLines.length, 6);
  });

  it("does NOT apply highlight to non-heading lines", () => {
    const frag = renderMarkdown("# heading\nplain paragraph\nanother line");
    const nonHeadingHl = frag.highlights.filter(
      (h) =>
        h.hlGroup === "EuropaCellMarkdown" && frag.lines[h.line] !== undefined,
    );
    // Only the heading line should have EuropaCellMarkdown
    for (const hl of nonHeadingHl) {
      const line = frag.lines[hl.line];
      assertEquals(line.startsWith("#"), true);
    }
  });

  it("does NOT highlight # without trailing space (not a heading)", () => {
    const frag = renderMarkdown("#nospace\n## valid heading");
    const hlGroups = frag.highlights.filter(
      (h) => h.hlGroup === "EuropaCellMarkdown",
    );
    // Only '## valid heading' should be highlighted
    assertEquals(hlGroups.length, 1);
  });

  it("returns all lines in the fragment", () => {
    const source = "# Title\nparagraph\n## Sub";
    const frag = renderMarkdown(source);
    assertEquals(frag.lines.length, 3);
    assertEquals(frag.lines[0], "# Title");
    assertEquals(frag.lines[1], "paragraph");
    assertEquals(frag.lines[2], "## Sub");
  });

  it("handles empty source", () => {
    const frag = renderMarkdown("");
    assertExists(frag.lines);
    assertExists(frag.highlights);
  });
});
