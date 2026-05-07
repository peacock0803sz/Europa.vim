/**
 * BDD specs for insertCell, deleteCell, and moveCell.
 *
 * @spec-id europa.notebook.cell.insert
 * @spec-id europa.notebook.cell.delete
 * @spec-id europa.notebook.cell.move
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import {
  deleteCell,
  insertCell,
  isValidCellId,
  moveCell,
} from "../../../../denops/europa/notebook/cell.ts";
import { parseNotebook } from "../../../../denops/europa/notebook/parse.ts";
import type { Notebook } from "../../../../schema/notebook.ts";
import {
  CELL_CODE,
  CELL_MD,
  CELL_RAW,
  makeMinimalNotebook,
} from "./_helpers.ts";

// --- insertCell (europa.notebook.cell.insert) ---

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
    assertEquals(result.notebook.cells.length, 3);
    assertEquals(result.notebook.cells[0].id, CELL_CODE);
    assertEquals(result.notebook.cells[1].cell_type, "code");
    assertEquals(result.notebook.cells[1].id, result.cellId);
    assertEquals(result.notebook.cells[2].id, CELL_MD);
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
    assertEquals(result.notebook.cells.length, 2);
    assertEquals(result.notebook.cells[0].cell_type, "markdown");
    assertEquals(result.notebook.cells[0].id, result.cellId);
    assertEquals(result.notebook.cells[1].id, CELL_CODE);
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
    assertEquals(result.notebook.cells[0].cell_type, "raw");
    assertEquals(result.notebook.cells[0].id, result.cellId);
  });

  it("new cell has id = uuid v7 and matches result.cellId", () => {
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
    const newCell = result.notebook.cells[1];
    assertEquals(isValidCellId(newCell.id), true);
    assertEquals(newCell.id, result.cellId);
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
    assertEquals(result.notebook.cells[1].source, "");
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
    const newCell = result.notebook.cells[1];
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
    assertEquals(result.notebook.cells[1].metadata, {});
  });

  it("inserts as first cell when notebook is empty (anchor ignored)", () => {
    const nb = makeMinimalNotebook([]);
    const result = insertCell(nb, "after", "code", null);
    assertEquals(result.notebook.cells.length, 1);
    assertEquals(result.notebook.cells[0].cell_type, "code");
    assertEquals(result.notebook.cells[0].id, result.cellId);
  });

  it("throws when anchorCellId is null on a non-empty notebook", () => {
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
      () => insertCell(nb, "after", "code", null),
      Error,
      "anchorCellId is required",
    );
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
    assertEquals(Object.is(nb, result.notebook), false);
    assertEquals(Object.is(nb.cells, result.notebook.cells), false);
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
    assertEquals(Object.is(result.notebook.cells[0], nb.cells[0]), true);
  });

  it("round-trip with edit-target.ipynb fixture", async () => {
    const raw = await Deno.readTextFile(
      new URL("../../../golden/ipynb/edit-target.ipynb", import.meta.url),
    );
    const nb = await parseNotebook(raw);
    assertEquals(nb.cells.length, 5);
    const result = insertCell(nb, "after", "code", nb.cells[0].id);
    assertEquals(result.notebook.cells.length, 6);
    assertEquals(result.notebook.cells[1].cell_type, "code");
    assertEquals(result.notebook.cells[1].source, "");
    assertEquals(result.notebook.cells[1].id, result.cellId);
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
      new URL("../../../golden/ipynb/edit-target.ipynb", import.meta.url),
    );
    const nb = await parseNotebook(raw);
    const firstId = nb.cells[0].id;
    const result = deleteCell(nb, firstId);
    assertEquals(result.cells.length, 4);
    assertEquals(result.cells[0].id !== firstId, true);
  });
});

// --- moveCell (europa.notebook.cell.move) ---

describe("moveCell", () => {
  function makeThreeCells(): Notebook {
    return makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "print(0)",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
      { cell_type: "raw", id: CELL_RAW, source: "raw text", metadata: {} },
    ]);
  }

  it("swaps a middle cell down with the next one", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, CELL_MD, "down");
    assertEquals(result.cells.map((c) => c.id), [CELL_CODE, CELL_RAW, CELL_MD]);
  });

  it("swaps a middle cell up with the previous one", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, CELL_MD, "up");
    assertEquals(result.cells.map((c) => c.id), [CELL_MD, CELL_CODE, CELL_RAW]);
  });

  it("returns the same notebook reference when moving the first cell up (no-op)", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, CELL_CODE, "up");
    assertEquals(Object.is(nb, result), true);
  });

  it("returns the same notebook reference when moving the last cell down (no-op)", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, CELL_RAW, "down");
    assertEquals(Object.is(nb, result), true);
  });

  it("returns the same notebook reference when cellId is not found (no-op)", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, "nonexistent-id", "up");
    assertEquals(Object.is(nb, result), true);
  });

  it("is immutable — input notebook reference is unchanged on a real move", () => {
    const nb = makeThreeCells();
    const originalCells = nb.cells;
    const result = moveCell(nb, CELL_MD, "down");
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    assertEquals(Object.is(nb.cells, originalCells), true);
    assertEquals(nb.cells.map((c) => c.id), [CELL_CODE, CELL_MD, CELL_RAW]);
  });

  it("preserves untouched cell references via structural sharing", () => {
    const nb = makeThreeCells();
    const result = moveCell(nb, CELL_MD, "down");
    // The cell at the front (index 0) is not involved in the swap and
    // therefore should be the exact same object reference.
    assertEquals(Object.is(result.cells[0], nb.cells[0]), true);
    // The two swapped cells must also remain the same object references —
    // moveCell only reorders the array, it never rebuilds the cells.
    assertEquals(Object.is(result.cells[1], nb.cells[2]), true);
    assertEquals(Object.is(result.cells[2], nb.cells[1]), true);
  });

  it("round-trip with edit-target.ipynb fixture", async () => {
    const raw = await Deno.readTextFile(
      new URL("../../../golden/ipynb/edit-target.ipynb", import.meta.url),
    );
    const nb = await parseNotebook(raw);
    const firstId = nb.cells[0].id;
    const secondId = nb.cells[1].id;
    const result = moveCell(nb, firstId, "down");
    assertEquals(result.cells[0].id, secondId);
    assertEquals(result.cells[1].id, firstId);
    assertEquals(result.cells.length, nb.cells.length);
  });
});
