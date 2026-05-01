/**
 * BDD specs for cell helpers: assignCellId, joinSource, insertCell, deleteCell.
 *
 * @spec-id europa.notebook.cell.assign-id
 * @spec-id europa.notebook.cell.join-source
 * @spec-id europa.notebook.cell.insert
 * @spec-id europa.notebook.cell.delete
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  assignCellId,
  deleteCell,
  insertCell,
  isValidCellId,
  joinSource,
} from "../../../denops/europa/notebook/cell.ts";
import { parseNotebook } from "../../../denops/europa/notebook/parse.ts";
import type { Notebook } from "../../../schema/notebook.ts";

describe("assignCellId", () => {
  it("returns a non-empty string", () => {
    const id = assignCellId();
    assertEquals(typeof id, "string");
    assertEquals(id.length > 0, true);
  });

  it("returns a well-formed uuid v7 (version + variant bits)", () => {
    const id = assignCellId();
    assertEquals(isValidCellId(id), true);
  });

  it("returns a different id on each call", () => {
    const id1 = assignCellId();
    const id2 = assignCellId();
    assertNotEquals(id1, id2);
  });
});

describe("joinSource", () => {
  it("returns a string argument unchanged", () => {
    assertEquals(joinSource("hello"), "hello");
    assertEquals(joinSource(""), "");
  });

  it("joins a string[] with empty separator (jupyter convention)", () => {
    assertEquals(joinSource(["a\n", "b\n", "c"]), "a\nb\nc");
  });

  it("returns empty string for empty array", () => {
    assertEquals(joinSource([]), "");
  });

  it("handles a single-element array", () => {
    assertEquals(joinSource(["only"]), "only");
  });
});

// --- insertCell (europa.notebook.cell.insert) ---

function makeMinimalNotebook(cells: Notebook["cells"] = []): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  };
}

const CELL_CODE = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
const CELL_MD = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";

describe("insertCell", () => {
  it("inserts a code cell after the anchor", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    assertEquals(result.cells.length, 3);
    assertEquals(result.cells[0].id, CELL_CODE);
    assertEquals(result.cells[1].cell_type, "code");
    assertEquals(result.cells[2].id, CELL_MD);
  });

  it("inserts a markdown cell before the anchor", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "before", "markdown", CELL_CODE);
    assertEquals(result.cells.length, 2);
    assertEquals(result.cells[0].cell_type, "markdown");
    assertEquals(result.cells[1].id, CELL_CODE);
  });

  it("inserts a raw cell before the anchor", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "before", "raw", CELL_CODE);
    assertEquals(result.cells[0].cell_type, "raw");
  });

  it("new cell has id = uuid v7", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    const newCell = result.cells[1];
    assertEquals(isValidCellId(newCell.id), true);
  });

  it("new cell has empty source", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    assertEquals(result.cells[1].source, "");
  });

  it("new code cell has outputs=[] and execution_count=null", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    const newCell = result.cells[1];
    if (newCell.cell_type === "code") {
      assertEquals(newCell.outputs, []);
      assertEquals(newCell.execution_count, null);
    }
  });

  it("new cell has metadata={}", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    assertEquals(result.cells[1].metadata, {});
  });

  it("throws when anchorCellId is not found", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    assertThrows(
      () => insertCell(nb, "after", "code", "nonexistent-id"),
      Error,
    );
  });

  it("is immutable — input notebook reference is unchanged", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const originalCells = nb.cells;
    const result = insertCell(nb, "after", "code", CELL_CODE);
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    // Same reference → still points at the original (un-mutated) array
    assertEquals(Object.is(nb.cells, originalCells), true);
    // And the contents of that array were not mutated in place
    assertEquals(nb.cells.length, 1);
    assertEquals(nb.cells[0].id, CELL_CODE);
  });

  it("untouched cells are structurally shared", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = insertCell(nb, "after", "code", CELL_CODE);
    // cell at index 0 (before insertion point) is same object reference
    assertEquals(Object.is(result.cells[0], nb.cells[0]), true);
  });

  it("round-trip with edit-target.ipynb fixture", async () => {
    const raw = await Deno.readTextFile(
      new URL("../../golden/ipynb/edit-target.ipynb", import.meta.url),
    );
    const nb = await parseNotebook(raw);
    assertEquals(nb.cells.length, 5);
    const result = insertCell(nb, "after", "code", nb.cells[0].id);
    assertEquals(result.cells.length, 6);
    assertEquals(result.cells[1].cell_type, "code");
    assertEquals(result.cells[1].source, "");
  });
});

// --- deleteCell (europa.notebook.cell.delete) ---

describe("deleteCell", () => {
  it("removes the cell with the given cellId", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = deleteCell(nb, CELL_CODE);
    assertEquals(result.cells.length, 1);
    assertEquals(result.cells[0].id, CELL_MD);
  });

  it("returns the same reference when cellId is not found (no-op)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = deleteCell(nb, "nonexistent-id");
    assertEquals(Object.is(nb, result), true);
  });

  it("cells array is empty after deleting the last cell", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = deleteCell(nb, CELL_CODE);
    assertEquals(result.cells, []);
  });

  it("is immutable — input notebook reference is unchanged", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = deleteCell(nb, CELL_CODE);
    assertEquals(Object.is(nb, result), false);
    assertEquals(nb.cells.length, 2);
  });

  it("round-trip with edit-target.ipynb fixture", async () => {
    const raw = await Deno.readTextFile(
      new URL("../../golden/ipynb/edit-target.ipynb", import.meta.url),
    );
    const nb = await parseNotebook(raw);
    const firstId = nb.cells[0].id;
    const result = deleteCell(nb, firstId);
    assertEquals(result.cells.length, 4);
    assertEquals(result.cells[0].id !== firstId, true);
  });
});
