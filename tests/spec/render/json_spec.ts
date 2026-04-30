/**
 * BDD specs for renderJson — 2-space pretty-print.
 *
 * @spec-id europa.render.json.pretty
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { renderJson } from "../../../denops/europa/render/json.ts";

describe("renderJson", () => {
  it("pretty-prints an object with 2-space indent", () => {
    const frag = renderJson({ x: 1, y: 2 });
    assertExists(frag.lines);
    // Lines include 2-space indented key-value pairs (may have trailing comma)
    assertEquals(frag.lines.some((l: string) => l.includes('"x": 1')), true);
    assertEquals(frag.lines.some((l: string) => l.includes('"y": 2')), true);
  });

  it("adds exactly one trailing newline (last line is empty string)", () => {
    const frag = renderJson({ a: 1 });
    assertEquals(frag.lines[frag.lines.length - 1], "");
  });

  it("renders arrays", () => {
    const frag = renderJson([1, 2, 3]);
    assertEquals(frag.lines[0], "[");
    assertEquals(frag.lines.some((l: string) => l.includes("1")), true);
  });

  it("renders null", () => {
    const frag = renderJson(null);
    assertEquals(frag.lines[0], "null");
  });

  it("renders primitives (number)", () => {
    const frag = renderJson(42);
    assertEquals(frag.lines[0], "42");
  });

  it("renders nested objects", () => {
    const frag = renderJson({ nested: { key: "value" } });
    assertEquals(frag.lines.some((l: string) => l.includes('"nested"')), true);
    assertEquals(frag.lines.some((l: string) => l.includes('"key"')), true);
  });
});
