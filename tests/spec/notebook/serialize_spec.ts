/**
 * BDD specs for serializeNotebook — format and golden round-trip.
 *
 * @spec-id europa.notebook.serialize.format
 * @spec-id europa.notebook.serialize.round-trip
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { serializeNotebook } from "../../../denops/europa/notebook/serialize.ts";
import { parseNotebook } from "../../../denops/europa/notebook/parse.ts";
import type { Notebook } from "../../../schema/notebook.ts";

function emptyNotebook(): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
}

describe("serializeNotebook", () => {
  it("uses 1-space indent", () => {
    const out = serializeNotebook(emptyNotebook());
    assertEquals(out.includes(' "nbformat"'), true);
  });

  it("ends with exactly one trailing newline", () => {
    const out = serializeNotebook(emptyNotebook());
    assertEquals(out.endsWith("\n"), true);
    assertEquals(out.endsWith("\n\n"), false);
  });

  it("preserves MIME bundle insertion order", () => {
    const nb: Notebook = {
      ...emptyNotebook(),
      cells: [{
        cell_type: "code",
        id: "abc123",
        source: "",
        execution_count: null,
        outputs: [{
          output_type: "execute_result",
          execution_count: 1,
          data: { "text/plain": "hello", "application/json": {} },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const out = serializeNotebook(nb);
    const plainIdx = out.indexOf('"text/plain"');
    const jsonIdx = out.indexOf('"application/json"');
    assertEquals(plainIdx < jsonIdx, true);
  });
});

describe("[golden] notebook round-trip", () => {
  const FIXTURES = [
    "hello",
    "multi-line-source",
    "pandas-output",
    "json-output",
    "markdown-html",
    "kitty-image",
    "ansi-stream",
    "large-1000cells",
  ];

  for (const name of FIXTURES) {
    it(`parse(serialize(parse(x))) === parse(x) for ${name}.ipynb`, async () => {
      const raw = await Deno.readTextFile(
        `tests/golden/ipynb/${name}.ipynb`,
      );
      const parsed = await parseNotebook(raw);
      const serialized = serializeNotebook(parsed);
      const roundTripped = await parseNotebook(serialized);
      assertEquals(roundTripped, parsed);
    });
  }
});
