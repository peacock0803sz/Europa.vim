/**
 * BDD specs for renderHtml — tag stripping (Phase 2).
 *
 * @spec-id europa.render.html.tag-strip
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { renderHtml } from "../../../denops/europa/render/html.ts";

describe("renderHtml", () => {
  it("strips simple tags and leaves text content", () => {
    const frag = renderHtml("<p>Hello world</p>");
    assertExists(frag.lines);
    const text = frag.lines.join("\n");
    assertEquals(text.includes("Hello world"), true);
    assertEquals(text.includes("<p>"), false);
    assertEquals(text.includes("</p>"), false);
  });

  it("strips nested tags", () => {
    const frag = renderHtml("<div><span>text</span></div>");
    const text = frag.lines.join("\n");
    assertEquals(text.includes("text"), true);
    assertEquals(text.includes("<"), false);
    assertEquals(text.includes(">"), false);
  });

  it("strips tags with attributes", () => {
    const frag = renderHtml('<a href="https://example.com">link text</a>');
    const text = frag.lines.join("\n");
    assertEquals(text.includes("link text"), true);
    assertEquals(text.includes("<a"), false);
  });

  it("handles self-closing tags", () => {
    const frag = renderHtml("before<br/>after");
    const text = frag.lines.join("\n");
    assertEquals(text.includes("before"), true);
    assertEquals(text.includes("after"), true);
    assertEquals(text.includes("<br"), false);
  });

  it("handles plain text without tags unchanged", () => {
    const frag = renderHtml("no tags here");
    assertEquals(frag.lines.join("\n").includes("no tags here"), true);
  });

  it("handles empty string", () => {
    const frag = renderHtml("");
    assertExists(frag.lines);
  });

  it("handles DataFrame-style HTML table (common pandas output)", () => {
    const html = "<table><tr><th>col</th></tr><tr><td>1</td></tr></table>";
    const frag = renderHtml(html);
    const text = frag.lines.join("\n");
    assertEquals(text.includes("col"), true);
    assertEquals(text.includes("1"), true);
    assertEquals(text.includes("<table"), false);
  });
});
