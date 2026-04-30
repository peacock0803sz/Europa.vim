/**
 * BDD specs for stripAnsi — ANSI escape code stripping.
 *
 * @spec-id europa.render.ansi.strip
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { stripAnsi } from "../../../denops/europa/render/ansi.ts";

describe("stripAnsi", () => {
  it("passes plain text through unchanged", () => {
    assertEquals(stripAnsi("hello world"), "hello world");
  });

  it("strips CSI SGR color codes", () => {
    // ESC[31m = red foreground, ESC[0m = reset
    const colored = "\x1b[31mred text\x1b[0m";
    assertEquals(stripAnsi(colored), "red text");
  });

  it("strips bold + color sequences", () => {
    const bold = "\x1b[1;32mbold green\x1b[0m normal";
    assertEquals(stripAnsi(bold), "bold green normal");
  });

  it("does not corrupt plain text adjacent to OSC sequences (library-limited)", () => {
    // @lambdalisue/ansi-escape-code handles CSI; OSC support depends on version.
    // This test only asserts the text portion remains intact.
    const osc = "\x1b]0;window title\x07plain";
    const result = stripAnsi(osc);
    assertEquals(result.includes("plain"), true);
  });

  it("does not corrupt text adjacent to DCS sequences (library-limited)", () => {
    // DCS stripping is library-level; we assert the text portion is preserved.
    const dcs = "\x1bP1$r0m\x1b\\text";
    const result = stripAnsi(dcs);
    assertEquals(result.includes("text"), true);
  });

  it("handles empty string", () => {
    assertEquals(stripAnsi(""), "");
  });

  it("handles multiple consecutive escape sequences", () => {
    const multi = "\x1b[31m\x1b[1mred bold\x1b[0m\x1b[0m";
    assertEquals(stripAnsi(multi), "red bold");
  });

  it("strips typical pytest colored output pattern", () => {
    const pytest = "\x1b[32mPASSED\x1b[0m tests/test_foo.py::test_bar";
    assertEquals(stripAnsi(pytest), "PASSED tests/test_foo.py::test_bar");
  });
});
