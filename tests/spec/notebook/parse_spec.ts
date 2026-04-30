/**
 * BDD specs for parseNotebook — normalize, id-completion, value-check.
 *
 * @spec-id europa.notebook.parse.normalize
 * @spec-id europa.notebook.parse.id-completion
 * @spec-id europa.notebook.parse.value-check
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  NotebookParseError,
  parseNotebook,
} from "../../../denops/europa/notebook/parse.ts";

function minimalNotebook(cells: unknown[], nbformatMinor = 5): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: nbformatMinor,
    metadata: {},
    cells,
  });
}

describe("parseNotebook", () => {
  it("joins string[] source into a single string", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      id: "abc123",
      source: ["line1\n", "line2"],
      execution_count: null,
      outputs: [],
      metadata: {},
    }]);
    const nb = await parseNotebook(raw);
    assertEquals(nb.cells[0].source, "line1\nline2");
  });

  it("joins string[] stream output text", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      id: "abc123",
      source: "",
      execution_count: null,
      outputs: [{ output_type: "stream", name: "stdout", text: ["a\n", "b"] }],
      metadata: {},
    }]);
    const nb = await parseNotebook(raw);
    // deno-lint-ignore no-explicit-any
    assertEquals((nb.cells[0] as any).outputs[0].text, "a\nb");
  });

  it("leaves already-string source unchanged", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      id: "abc123",
      source: "print('hello')",
      execution_count: null,
      outputs: [],
      metadata: {},
    }]);
    const nb = await parseNotebook(raw);
    assertEquals(nb.cells[0].source, "print('hello')");
  });
});

describe("parseNotebook", () => {
  it("assigns a non-empty string id when cell.id is absent", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      source: "",
      execution_count: null,
      outputs: [],
      metadata: {},
    }]);
    const nb = await parseNotebook(raw);
    assertEquals(typeof nb.cells[0].id, "string");
    assertEquals(nb.cells[0].id.length > 0, true);
  });

  it("upgrades nbformat_minor to 5 when an id is assigned", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      source: "",
      execution_count: null,
      outputs: [],
      metadata: {},
    }], 4);
    const nb = await parseNotebook(raw);
    assertEquals(nb.nbformat_minor, 5);
  });

  it("preserves nbformat_minor when all ids are already present", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      id: "abc123",
      source: "",
      execution_count: null,
      outputs: [],
      metadata: {},
    }], 4);
    const nb = await parseNotebook(raw);
    assertEquals(nb.nbformat_minor, 4);
  });

  it("generates distinct ids for each cell", async () => {
    const raw = minimalNotebook([
      {
        cell_type: "code",
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      {
        cell_type: "code",
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const nb = await parseNotebook(raw);
    assertEquals(nb.cells[0].id !== nb.cells[1].id, true);
  });
});

describe("parseNotebook", () => {
  it("throws NotebookParseError when JSON is invalid", async () => {
    const err = await assertRejects(
      () => parseNotebook("{ not valid json"),
      NotebookParseError,
    );
    assertInstanceOf(err, NotebookParseError);
  });

  it("throws NotebookParseError when nbformat !== 4", async () => {
    const raw = JSON.stringify({
      nbformat: 3,
      nbformat_minor: 0,
      metadata: {},
      cells: [],
    });
    await assertRejects(() => parseNotebook(raw), NotebookParseError);
  });

  it("throws NotebookParseError for unknown output_type", async () => {
    const raw = minimalNotebook([{
      cell_type: "code",
      id: "abc123",
      source: "",
      execution_count: null,
      outputs: [{ output_type: "NOT_VALID", data: {} }],
      metadata: {},
    }]);
    await assertRejects(() => parseNotebook(raw), NotebookParseError);
  });
});
