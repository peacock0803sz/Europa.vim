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

  it("strips <style> blocks including their CSS body", () => {
    const frag = renderHtml(
      "<style>.x{color:red}</style>hello",
    );
    const text = frag.lines.join("\n");
    assertEquals(text.includes("color:red"), false);
    assertEquals(text.includes("hello"), true);
  });

  it("strips <script> blocks including their JS body", () => {
    const frag = renderHtml("<script>alert(1)</script>after");
    const text = frag.lines.join("\n");
    assertEquals(text.includes("alert(1)"), false);
    assertEquals(text.includes("after"), true);
  });

  it("renders pandas DataFrame HTML as text table with header rule", () => {
    const html = [
      "<div>\n",
      "<style scoped>\n",
      "    .dataframe tbody tr th:only-of-type {\n",
      "        vertical-align: middle;\n",
      "    }\n",
      "\n",
      "    .dataframe tbody tr th {\n",
      "        vertical-align: top;\n",
      "    }\n",
      "\n",
      "    .dataframe thead th {\n",
      "        text-align: right;\n",
      "    }\n",
      "</style>\n",
      '<table border="1" class="dataframe">\n',
      "  <thead>\n",
      '    <tr style="text-align: right;">\n',
      "      <th></th>\n",
      "      <th>A</th>\n",
      "      <th>B</th>\n",
      "    </tr>\n",
      "  </thead>\n",
      "  <tbody>\n",
      "    <tr>\n",
      "      <th>0</th>\n",
      "      <td>1</td>\n",
      "      <td>4</td>\n",
      "    </tr>\n",
      "    <tr>\n",
      "      <th>1</th>\n",
      "      <td>2</td>\n",
      "      <td>5</td>\n",
      "    </tr>\n",
      "    <tr>\n",
      "      <th>2</th>\n",
      "      <td>3</td>\n",
      "      <td>6</td>\n",
      "    </tr>\n",
      "  </tbody>\n",
      "</table>\n",
      "</div>",
    ].join("");

    const frag = renderHtml(html);

    assertEquals(
      frag.lines.some((l) => l.includes("vertical-align")),
      false,
      "CSS body must not leak into output",
    );

    const expected = [
      "   | A | B |",
      "------------",
      " 0 | 1 | 4 |",
      " 1 | 2 | 5 |",
      " 2 | 3 | 6 |",
    ];
    const indices = expected.map((line) => frag.lines.indexOf(line));
    for (let i = 0; i < expected.length; i++) {
      assertEquals(
        indices[i] >= 0,
        true,
        `expected line ${JSON.stringify(expected[i])} in output`,
      );
    }
    for (let i = 1; i < indices.length; i++) {
      assertEquals(
        indices[i] > indices[i - 1],
        true,
        "expected lines preserve order",
      );
    }
  });

  it("treats first row as header when <thead> is absent", () => {
    const html =
      "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>";
    const frag = renderHtml(html);
    assertEquals(frag.lines.includes(" a | b |"), true);
    assertEquals(frag.lines.includes("--------"), true);
    assertEquals(frag.lines.includes(" c | d |"), true);
  });

  it("pads cells to per-column max width", () => {
    const html =
      "<table><tr><th>x</th><th>name</th></tr><tr><td>1</td><td>al</td></tr></table>";
    const frag = renderHtml(html);
    assertEquals(frag.lines.includes(" x | name |"), true);
    assertEquals(frag.lines.includes("-----------"), true);
    assertEquals(frag.lines.includes(" 1 | al   |"), true);
  });

  it("normalizes whitespace inside table cells", () => {
    const html = "<table><tr><th>a</th><th>b\n  c</th></tr>" +
      "<tr><td>1</td><td>2</td></tr></table>";
    const frag = renderHtml(html);
    assertEquals(frag.lines.includes(" a | b c |"), true);
  });

  it("strips inner tags inside table cells", () => {
    const html =
      "<table><tr><th>name</th></tr><tr><td><b>bold</b></td></tr></table>";
    const frag = renderHtml(html);
    assertEquals(frag.lines.includes(" name |"), true);
    assertEquals(frag.lines.includes(" bold |"), true);
    const text = frag.lines.join("\n");
    assertEquals(text.includes("<b>"), false);
  });

  it("breaks lines on block-level opening tags so adjacent text stays separated", () => {
    const frag = renderHtml("<p>first</p><p>second</p><div>third</div>");
    const firstIdx = frag.lines.findIndex((l) => l.includes("first"));
    const secondIdx = frag.lines.findIndex((l) => l.includes("second"));
    const thirdIdx = frag.lines.findIndex((l) => l.includes("third"));
    assertEquals(firstIdx >= 0, true);
    assertEquals(secondIdx > firstIdx, true, "second must be on a later line");
    assertEquals(thirdIdx > secondIdx, true, "third must be on a later line");
  });
});
