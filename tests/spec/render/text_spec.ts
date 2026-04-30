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
});
