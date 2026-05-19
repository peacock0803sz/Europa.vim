/**
 * BDD specs for renderMarkdown inline overlay (Phase 3.7).
 *
 * @spec-id europa.render.markdown.inline-decoration
 */
import { assertEquals } from "@std/assert";
import type { Highlight, MdDecoration } from "../../../schema/render-plan.ts";
import { renderMarkdown } from "../../../denops/europa/render/markdown.ts";

function sortDecorations(decorations: MdDecoration[]): MdDecoration[] {
  return [...decorations].sort((a, b) =>
    a.line - b.line ||
    a.colStart - b.colStart ||
    a.colEnd - b.colEnd ||
    (a.conceal ?? "").localeCompare(b.conceal ?? "") ||
    (a.virtText ?? "").localeCompare(b.virtText ?? "") ||
    (a.virtTextHlGroup ?? "").localeCompare(b.virtTextHlGroup ?? "") ||
    (a.hlGroup ?? "").localeCompare(b.hlGroup ?? "") ||
    Number(a.hlEol ?? false) - Number(b.hlEol ?? false)
  );
}

function sortHighlights(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) =>
    a.line - b.line ||
    a.col - b.col ||
    a.endCol - b.endCol ||
    a.hlGroup.localeCompare(b.hlGroup)
  );
}

Deno.test("renderMarkdown inline overlay", async (t) => {
  await t.step("(a) bold", () => {
    const frag = renderMarkdown("**foo**");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 2, conceal: "" },
      { line: 0, colStart: 2, colEnd: 5, hlGroup: "EuropaMdBold" },
      { line: 0, colStart: 5, colEnd: 7, conceal: "" },
    ]);
  });

  await t.step("(b) italic", () => {
    const frag = renderMarkdown("*foo*\n_bar_");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, conceal: "" },
      { line: 0, colStart: 1, colEnd: 4, hlGroup: "EuropaMdItalic" },
      { line: 0, colStart: 4, colEnd: 5, conceal: "" },
      { line: 1, colStart: 0, colEnd: 1, conceal: "" },
      { line: 1, colStart: 1, colEnd: 4, hlGroup: "EuropaMdItalic" },
      { line: 1, colStart: 4, colEnd: 5, conceal: "" },
    ]);
  });

  await t.step("(c) bold-italic", () => {
    const frag = renderMarkdown("***foo***");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, conceal: "" },
      { line: 0, colStart: 1, colEnd: 3, conceal: "" },
      { line: 0, colStart: 1, colEnd: 8, hlGroup: "EuropaMdItalic" },
      { line: 0, colStart: 3, colEnd: 6, hlGroup: "EuropaMdBold" },
      { line: 0, colStart: 6, colEnd: 8, conceal: "" },
      { line: 0, colStart: 8, colEnd: 9, conceal: "" },
    ]);
  });

  await t.step("(d) inline code", () => {
    const frag = renderMarkdown("`foo`");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, conceal: "" },
      { line: 0, colStart: 1, colEnd: 4, hlGroup: "EuropaMdCode" },
      { line: 0, colStart: 4, colEnd: 5, conceal: "" },
    ]);
  });

  await t.step("(e) link", () => {
    const frag = renderMarkdown("[click](https://x)");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, conceal: "" },
      { line: 0, colStart: 1, colEnd: 6, hlGroup: "EuropaMdLink" },
      { line: 0, colStart: 6, colEnd: 18, conceal: "" },
    ]);
  });

  await t.step("(f) autolink", () => {
    const frag = renderMarkdown("<https://x>");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, conceal: "" },
      { line: 0, colStart: 1, colEnd: 10, hlGroup: "EuropaMdLink" },
      { line: 0, colStart: 10, colEnd: 11, conceal: "" },
    ]);
  });

  await t.step("(g) image", () => {
    const frag = renderMarkdown("![alt](path)");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 2, conceal: "" },
      { line: 0, colStart: 2, colEnd: 5, hlGroup: "EuropaMdLink" },
      { line: 0, colStart: 5, colEnd: 12, conceal: "" },
    ]);
  });

  await t.step("(h) unordered list", () => {
    const frag = renderMarkdown("- item\n* item\n+ item");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 1, hlGroup: "EuropaMdListMarker" },
      { line: 1, colStart: 0, colEnd: 1, hlGroup: "EuropaMdListMarker" },
      { line: 2, colStart: 0, colEnd: 1, hlGroup: "EuropaMdListMarker" },
    ]);
  });

  await t.step("(i) ordered list", () => {
    const frag = renderMarkdown("1. item\n2) next");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 2, hlGroup: "EuropaMdListMarker" },
      { line: 1, colStart: 0, colEnd: 2, hlGroup: "EuropaMdListMarker" },
    ]);
  });

  await t.step("(j) blockquote", () => {
    const frag = renderMarkdown("> quoted\n>> nested");
    assertEquals(sortDecorations(frag.mdDecorations), [
      {
        line: 0,
        colStart: 0,
        colEnd: 1,
        hlGroup: "EuropaMdQuote",
        hlEol: true,
      },
      {
        line: 1,
        colStart: 0,
        colEnd: 2,
        hlGroup: "EuropaMdQuote",
        hlEol: true,
      },
    ]);
  });

  await t.step("(k) horizontal rule", () => {
    const frag = renderMarkdown("---\n***\n___");
    assertEquals(sortDecorations(frag.mdDecorations), [
      {
        line: 0,
        colStart: 0,
        colEnd: 3,
        hlGroup: "EuropaMdRule",
        hlEol: true,
      },
      {
        line: 1,
        colStart: 0,
        colEnd: 3,
        hlGroup: "EuropaMdRule",
        hlEol: true,
      },
      {
        line: 2,
        colStart: 0,
        colEnd: 3,
        hlGroup: "EuropaMdRule",
        hlEol: true,
      },
    ]);
  });

  await t.step("(l) strikethrough", () => {
    const frag = renderMarkdown("~~foo~~");
    assertEquals(sortDecorations(frag.mdDecorations), [
      { line: 0, colStart: 0, colEnd: 2, conceal: "" },
      { line: 0, colStart: 2, colEnd: 5, hlGroup: "EuropaMdStrike" },
      { line: 0, colStart: 5, colEnd: 7, conceal: "" },
    ]);
  });

  await t.step("(m) code fence", () => {
    const frag = renderMarkdown('```python\nprint("hi")\n```\n');
    assertEquals(sortDecorations(frag.mdDecorations), [
      {
        line: 0,
        colStart: 0,
        colEnd: 3,
        conceal: "",
        virtText: "python",
        virtTextHlGroup: "EuropaMdFenceLang",
      },
      { line: 2, colStart: 0, colEnd: 3, conceal: "" },
    ]);
    assertEquals(
      frag.mdDecorations.filter((decoration) => decoration.line === 1),
      [],
    );
  });

  await t.step("(n) ATX heading", () => {
    const frag = renderMarkdown("# H1");
    assertEquals(sortHighlights(frag.highlights), [{
      hlGroup: "EuropaCellMarkdown",
      line: 0,
      col: 0,
      endCol: -1,
    }]);
    assertEquals(
      frag.mdDecorations.filter((decoration) => decoration.line === 0),
      [],
    );
  });

  await t.step("(o) malformed source", () => {
    const source = "[unmatched\n**no close";
    const frag = renderMarkdown(source);
    assertEquals(frag.lines, source.split("\n"));
    assertEquals(frag.mdDecorations, []);
  });

  await t.step("(p) empty and whitespace-only source", () => {
    const empty = renderMarkdown("");
    assertEquals(empty.lines, [""]);
    assertEquals(empty.mdDecorations, []);

    const whitespace = renderMarkdown("  \n\t");
    assertEquals(whitespace.lines, ["  ", "\t"]);
    assertEquals(whitespace.mdDecorations, []);
  });

  await t.step(
    "(r) decoration line/col stays within actual source bytes",
    () => {
      // Regression: list-marker emission used to overshoot itemLine when
      // marked produced item.raw with a trailing newline, placing decorations
      // on blank lines (and triggering nvim_buf_set_extmark out-of-range).
      const source = [
        "- item 1",
        "- item 2",
        "",
        "1. one",
        "2. two",
        "",
        "> quoted line",
        "",
        "---",
      ].join("\n");
      const frag = renderMarkdown(source);
      const lines = frag.lines;
      for (const decoration of frag.mdDecorations) {
        const lineLen = (lines[decoration.line] ?? "").length;
        assertEquals(
          decoration.line >= 0 && decoration.line < lines.length,
          true,
          `decoration.line ${decoration.line} out of range`,
        );
        assertEquals(
          decoration.colEnd <= lineLen,
          true,
          `colEnd=${decoration.colEnd} > line length ${lineLen} on line ${decoration.line} (\"${
            lines[decoration.line]
          }\")`,
        );
      }
    },
  );

  await t.step("(q) setext heading", () => {
    const frag = renderMarkdown("Title\n===\n\nSub\n---\n");
    assertEquals(sortHighlights(frag.highlights), [
      { hlGroup: "EuropaCellMarkdown", line: 0, col: 0, endCol: -1 },
      { hlGroup: "EuropaCellMarkdown", line: 1, col: 0, endCol: -1 },
      { hlGroup: "EuropaCellMarkdown", line: 3, col: 0, endCol: -1 },
      { hlGroup: "EuropaCellMarkdown", line: 4, col: 0, endCol: -1 },
    ]);
    assertEquals(
      frag.mdDecorations.filter((decoration) =>
        decoration.line === 1 || decoration.line === 4
      ),
      [],
    );
  });
});
