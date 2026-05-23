/**
 * BDD specs for renderText / renderStream / renderError.
 *
 * @spec-id europa.render.text.plain
 * @spec-id europa.render.text.stream
 * @spec-id europa.render.text.error
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import {
  renderError,
  renderStream,
  renderText,
} from "../../../denops/europa/render/text.ts";

describe("renderText", () => {
  it("returns a RenderFragment with lines split on newline", () => {
    const frag = renderText("line1\nline2\nline3");
    assertExists(frag.lines);
    assertEquals(frag.lines.length, 3);
    assertEquals(frag.lines[0], "line1");
    assertEquals(frag.lines[2], "line3");
  });

  it("strips ANSI codes from text", () => {
    const frag = renderText("\x1b[31mred\x1b[0m");
    assertEquals(frag.lines[0], "red");
  });

  it("preserves trailing whitespace", () => {
    const frag = renderText("hello   ");
    assertEquals(frag.lines[0], "hello   ");
  });

  it("handles single-line text without trailing newline", () => {
    const frag = renderText("single line");
    assertEquals(frag.lines.length, 1);
    assertEquals(frag.lines[0], "single line");
  });
});

describe("renderStream", () => {
  it("stdout stream has EuropaStream highlight", () => {
    const frag = renderStream("stdout", "output text\n");
    assertExists(frag.highlights);
    const hlGroups = frag.highlights.map((h) => h.hlGroup);
    assertEquals(hlGroups.some((g) => g === "EuropaStream"), true);
  });

  it("stderr stream has EuropaStreamErr highlight", () => {
    const frag = renderStream("stderr", "error text\n");
    assertExists(frag.highlights);
    const hlGroups = frag.highlights.map((h) => h.hlGroup);
    assertEquals(hlGroups.some((g) => g === "EuropaStreamErr"), true);
  });

  it("strips ANSI from stream output", () => {
    const frag = renderStream("stdout", "\x1b[32mgreen\x1b[0m\n");
    assertEquals(frag.lines.some((l) => l.includes("green")), true);
    assertEquals(frag.lines.every((l) => !l.includes("\x1b")), true);
  });

  it("preserves trailing whitespace in stream lines", () => {
    const frag = renderStream("stdout", "padded  \n");
    assertEquals(frag.lines.some((l) => l.includes("padded  ")), true);
  });
});

describe("renderError", () => {
  it("places ename: evalue on first line", () => {
    const frag = renderError("ValueError", "bad input", []);
    assertExists(frag.lines);
    assertEquals(frag.lines[0].includes("ValueError"), true);
    assertEquals(frag.lines[0].includes("bad input"), true);
  });

  it("appends traceback lines after the header", () => {
    const frag = renderError("TypeError", "msg", [
      "  File foo.py",
      "    x = 1",
    ]);
    assertEquals(frag.lines.length >= 3, true);
    assertEquals(frag.lines.some((l) => l.includes("File foo.py")), true);
  });

  it("applies EuropaError highlight to traceback lines", () => {
    const frag = renderError("RuntimeError", "oops", ["traceback line"]);
    assertExists(frag.highlights);
    const hlGroups = frag.highlights.map((h) => h.hlGroup);
    assertEquals(hlGroups.some((g) => g === "EuropaError"), true);
  });

  it("strips ANSI from traceback", () => {
    const frag = renderError("E", "v", ["\x1b[31mtraceback\x1b[0m"]);
    assertEquals(frag.lines.every((l) => !l.includes("\x1b")), true);
  });

  it("strips ANSI from ename/evalue header (IPython color-prefix case)", () => {
    const frag = renderError(
      "\x1b[0;31mValueError\x1b[0m",
      "\x1b[1;33mbad input\x1b[0m",
      [],
    );
    assertEquals(frag.lines[0], "ValueError: bad input");
    assertEquals(frag.lines.every((l) => !l.includes("\x1b")), true);
  });

  it("splits traceback entries on embedded newlines (IPython multi-line frame)", () => {
    const frag = renderError("E", "v", [
      "Cell In[3], line 1\n----> 1 raise ValueError",
      "single",
    ]);
    assertEquals(frag.lines, [
      "E: v",
      "Cell In[3], line 1",
      "----> 1 raise ValueError",
      "single",
    ]);
    assertEquals(frag.highlights.length >= 3, true);
    assertEquals(
      frag.highlights.filter((h) => h.hlGroup === "EuropaError").length,
      3,
    );
    assertEquals(
      frag.highlights
        .filter((h) => h.hlGroup === "EuropaError")
        .map((h) => h.line),
      [1, 2, 3],
    );
  });
});

// Coverage for the IPython 8.x traceback clickable wiring; the underlying
// parser is exercised by `traceback-parser_spec.ts` (= the canonical
// `europa.render.traceback.parse.ipython8` declaration site). View-layer
// jump spec-ids (`europa.view.traceback-jump.{cell-line,external-file}`)
// are declared in `schema/render-plan.ts` ClickAction variants and will be
// implemented in the upcoming `view/traceback-jump.ts` module.
describe("renderError — IPython 8.x traceback clickables", () => {
  it("emits a jump_to_cell_line clickable for `Cell In[N], line K` (T019 a)", () => {
    const frag = renderError("ValueError", "oops", ["Cell In[3], line 5"]);
    assertEquals(frag.clickables.length, 1);
    const c = frag.clickables[0];
    assertEquals(c.line, 1);
    assertEquals(c.colStart, 0);
    // "Cell In[3], line 5" has 18 characters → half-open [0, 18)
    assertEquals(c.colEnd, 18);
    assertEquals(c.action.type, "jump_to_cell_line");
    if (c.action.type === "jump_to_cell_line") {
      assertEquals(c.action.payload.executionCount, 3);
      assertEquals(c.action.payload.line, 5);
    }
  });

  it("emits an EuropaErrorJump highlight on the cell frame range (T019 b)", () => {
    const frag = renderError("ValueError", "oops", ["Cell In[3], line 5"]);
    const jumpHls = frag.highlights.filter(
      (h) => h.hlGroup === "EuropaErrorJump",
    );
    assertEquals(jumpHls.length, 1);
    const hl = jumpHls[0];
    assertEquals(hl.line, 1);
    assertEquals(hl.col, 0);
    assertEquals(hl.endCol, 18);
    assertEquals(hl.hlEol ?? false, false);
  });

  it("preserves Phase 2 EuropaError line-hl regression-guard (T019 c)", () => {
    const frag = renderError("ValueError", "oops", ["Cell In[3], line 5"]);
    const lineHls = frag.highlights.filter((h) => h.hlGroup === "EuropaError");
    assertEquals(lineHls.length, 1);
    assertEquals(lineHls[0].line, 1);
    assertEquals(lineHls[0].col, 0);
    assertEquals(lineHls[0].endCol, -1);
  });

  it("emits jump_to_file + EuropaErrorJump for `File ~/x.py:10, in foo()` (T019 d)", () => {
    const frag = renderError("E", "v", ["File ~/x.py:10, in foo()"]);
    assertEquals(frag.clickables.length, 1);
    const c = frag.clickables[0];
    assertEquals(c.action.type, "jump_to_file");
    if (c.action.type === "jump_to_file") {
      assertEquals(c.action.payload.path, "~/x.py");
      assertEquals(c.action.payload.line, 10);
    }
    const jumpHls = frag.highlights.filter(
      (h) => h.hlGroup === "EuropaErrorJump",
    );
    assertEquals(jumpHls.length, 1);
    assertEquals(jumpHls[0].line, 1);
    // Whole "File ~/x.py:10, in foo()" range is highlighted (Session Q-file-in-func)
    assertEquals(jumpHls[0].col, 0);
    assertEquals(jumpHls[0].endCol, "File ~/x.py:10, in foo()".length);
  });

  it("uses fragment-relative line (header = line 0) for clickables (T019 e)", () => {
    const frag = renderError("E", "v", ["Cell In[3], line 5"]);
    assertEquals(frag.lines[0], "E: v");
    assertEquals(frag.lines[1], "Cell In[3], line 5");
    // header at index 0, traceback frame at index 1 — clickable.line MUST be 1
    assertEquals(frag.clickables[0].line, 1);
  });

  it("emits nothing for non-frame plain text", () => {
    const frag = renderError("E", "v", ["just plain text"]);
    assertEquals(frag.clickables.length, 0);
    const jumpHls = frag.highlights.filter(
      (h) => h.hlGroup === "EuropaErrorJump",
    );
    assertEquals(jumpHls.length, 0);
  });

  it("preserves clickable line indices across embedded-newline flatten", () => {
    const frag = renderError("E", "v", [
      "Cell In[3], line 1\n----> 1 raise ValueError",
      "Cell In[3], line 5",
    ]);
    // header=0, Cell In[3] line 1=1, ----> 1...=2, Cell In[3] line 5=3
    assertEquals(frag.clickables.length, 2);
    assertEquals(frag.clickables[0].line, 1);
    assertEquals(frag.clickables[1].line, 3);
  });
});
