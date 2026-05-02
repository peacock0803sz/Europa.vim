/**
 * BDD specs for cell helpers: assignCellId, joinSource, insertCell,
 * deleteCell, moveCell, splitCell, joinCell, updateCellSource, changeCellType.
 *
 * @spec-id europa.notebook.cell.assign-id
 * @spec-id europa.notebook.cell.join-source
 * @spec-id europa.notebook.cell.insert
 * @spec-id europa.notebook.cell.delete
 * @spec-id europa.notebook.cell.move
 * @spec-id europa.notebook.cell.split
 * @spec-id europa.notebook.cell.join
 * @spec-id europa.notebook.cell.update-source
 * @spec-id europa.notebook.cell.change-type
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  assignCellId,
  changeCellType,
  deleteCell,
  insertCell,
  isValidCellId,
  joinCell,
  joinSource,
  moveCell,
  splitCell,
  updateCellSource,
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
const CELL_RAW = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";

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
      new URL("../../golden/ipynb/edit-target.ipynb", import.meta.url),
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
      new URL("../../golden/ipynb/edit-target.ipynb", import.meta.url),
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
      new URL("../../golden/ipynb/edit-target.ipynb", import.meta.url),
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

// --- splitCell (europa.notebook.cell.split) ---

describe("splitCell", () => {
  function makeCodeCell(source: string): Notebook {
    return makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source,
        execution_count: 7,
        outputs: [{ output_type: "stream", name: "stdout", text: "x" }],
        metadata: { tags: ["keep"] },
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
  }

  it("splits a 5-line code cell at line 2 into [0..2) / [2..]", () => {
    const nb = makeCodeCell("a\nb\nc\nd\ne");
    const result = splitCell(nb, CELL_CODE, 2);
    assertEquals(result.cells.length, 3);
    assertEquals(result.cells[0].id, CELL_CODE);
    assertEquals(result.cells[0].source, "a\nb");
    assertEquals(result.cells[1].source, "c\nd\ne");
    assertEquals(result.cells[2].id, CELL_MD);
  });

  it("upper cell preserves id / outputs / execution_count / metadata", () => {
    const nb = makeCodeCell("a\nb\nc");
    const result = splitCell(nb, CELL_CODE, 2);
    const upper = result.cells[0];
    assertEquals(upper.id, CELL_CODE);
    assertEquals(upper.cell_type, "code");
    assertEquals(upper.metadata, { tags: ["keep"] });
    if (upper.cell_type === "code") {
      assertEquals(upper.execution_count, 7);
      assertEquals(upper.outputs.length, 1);
    }
  });

  it("lower cell has fresh uuid v7, outputs=[], execution_count=null", () => {
    const nb = makeCodeCell("a\nb\nc");
    const result = splitCell(nb, CELL_CODE, 2);
    const lower = result.cells[1];
    assertEquals(lower.cell_type, "code");
    assertEquals(isValidCellId(lower.id), true);
    assertNotEquals(lower.id, CELL_CODE);
    assertEquals(lower.metadata, {});
    if (lower.cell_type === "code") {
      assertEquals(lower.outputs, []);
      assertEquals(lower.execution_count, null);
    }
  });

  it("supports splitLine = 0 (upper cell receives empty source)", () => {
    const nb = makeCodeCell("a\nb\nc");
    const result = splitCell(nb, CELL_CODE, 0);
    assertEquals(result.cells[0].source, "");
    assertEquals(result.cells[1].source, "a\nb\nc");
  });

  it("supports splitLine = sourceLineCount (lower cell receives empty source)", () => {
    const nb = makeCodeCell("a\nb\nc");
    const result = splitCell(nb, CELL_CODE, 3);
    assertEquals(result.cells[0].source, "a\nb\nc");
    assertEquals(result.cells[1].source, "");
  });

  it("throws when splitLine is negative", () => {
    const nb = makeCodeCell("a\nb\nc");
    assertThrows(() => splitCell(nb, CELL_CODE, -1), Error, "out of range");
  });

  it("throws when splitLine is greater than source line count", () => {
    const nb = makeCodeCell("a\nb\nc");
    assertThrows(() => splitCell(nb, CELL_CODE, 4), Error, "out of range");
  });

  it("throws when cellId is not found", () => {
    const nb = makeCodeCell("a\nb\nc");
    assertThrows(
      () => splitCell(nb, "nonexistent-id", 1),
      Error,
      "not found",
    );
  });

  it("preserves markdown cell type when splitting a markdown cell", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "# heading\n\nbody line",
        metadata: {},
      },
    ]);
    const result = splitCell(nb, CELL_MD, 1);
    assertEquals(result.cells[0].cell_type, "markdown");
    assertEquals(result.cells[1].cell_type, "markdown");
    assertEquals(result.cells[0].source, "# heading");
    assertEquals(result.cells[1].source, "\nbody line");
  });

  it("copies markdown attachments to both halves so neither side dangles", () => {
    const attachments = {
      "logo.png": {
        "image/png": "iVBORw0KGgo=",
      },
    };
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "intro\n![attachment:logo.png]",
        attachments,
        metadata: {},
      },
    ]);
    const result = splitCell(nb, CELL_MD, 1);
    const upper = result.cells[0];
    const lower = result.cells[1];
    if (upper.cell_type === "markdown") {
      assertEquals(upper.attachments, attachments);
    }
    if (lower.cell_type === "markdown") {
      assertEquals(lower.attachments, attachments);
    }
  });

  it("does not add an attachments field to the lower half when the source had none", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "a\nb",
        metadata: {},
      },
    ]);
    const result = splitCell(nb, CELL_MD, 1);
    assertEquals("attachments" in result.cells[1], false);
  });

  it("is immutable — input notebook reference is unchanged", () => {
    const nb = makeCodeCell("a\nb\nc");
    const originalCells = nb.cells;
    const result = splitCell(nb, CELL_CODE, 1);
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    assertEquals(Object.is(nb.cells, originalCells), true);
    assertEquals(nb.cells.length, 2);
    assertEquals(nb.cells[0].source, "a\nb\nc");
  });
});

// --- joinCell (europa.notebook.cell.join) ---

describe("joinCell", () => {
  it("joins target cell with the previous cell using \\n", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: 3,
        outputs: [{ output_type: "stream", name: "stdout", text: "ok" }],
        metadata: { tags: ["prev"] },
      },
      {
        cell_type: "code",
        id: CELL_RAW,
        source: "y = 2",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = joinCell(nb, CELL_RAW);
    assertEquals(result.cells.length, 1);
    const merged = result.cells[0];
    assertEquals(merged.id, CELL_CODE);
    assertEquals(merged.source, "x = 1\ny = 2");
    assertEquals(merged.cell_type, "code");
    assertEquals(merged.metadata, { tags: ["prev"] });
    if (merged.cell_type === "code") {
      assertEquals(merged.execution_count, 3);
      assertEquals(merged.outputs.length, 1);
    }
  });

  it("returns the same reference when target is the first cell (no-op)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = joinCell(nb, CELL_CODE);
    assertEquals(Object.is(nb, result), true);
  });

  it("returns the same reference when cellId is not found (no-op)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = joinCell(nb, "nonexistent-id");
    assertEquals(Object.is(nb, result), true);
  });

  it("previous cell type wins on mixed-type join (code + markdown -> code)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "# heading",
        metadata: {},
      },
    ]);
    const result = joinCell(nb, CELL_MD);
    assertEquals(result.cells.length, 1);
    assertEquals(result.cells[0].cell_type, "code");
    assertEquals(result.cells[0].source, "x = 1\n# heading");
  });

  it("absorbed cell is removed from cells[]", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "a",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "b", metadata: {} },
      { cell_type: "raw", id: CELL_RAW, source: "c", metadata: {} },
    ]);
    const result = joinCell(nb, CELL_MD);
    assertEquals(result.cells.length, 2);
    assertEquals(result.cells.map((c) => c.id), [CELL_CODE, CELL_RAW]);
  });

  it("merges attachments when both halves are markdown", () => {
    const prevAttachments = {
      "a.png": { "image/png": "AAAA" },
    };
    const currAttachments = {
      "b.png": { "image/png": "BBBB" },
    };
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_CODE,
        source: "intro",
        attachments: prevAttachments,
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "body",
        attachments: currAttachments,
        metadata: {},
      },
    ]);
    const result = joinCell(nb, CELL_MD);
    const merged = result.cells[0];
    if (merged.cell_type === "markdown") {
      assertEquals(merged.attachments, {
        "a.png": prevAttachments["a.png"],
        "b.png": currAttachments["b.png"],
      });
    }
  });

  it("prefers prev's attachment on key collision (prev identity wins)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_CODE,
        source: "p",
        attachments: { "x.png": { "image/png": "PREV" } },
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "c",
        attachments: { "x.png": { "image/png": "CURR" } },
        metadata: {},
      },
    ]);
    const result = joinCell(nb, CELL_MD);
    const merged = result.cells[0];
    if (merged.cell_type === "markdown") {
      assertEquals(merged.attachments, {
        "x.png": { "image/png": "PREV" },
      });
    }
  });

  it("does not synthesise an empty attachments field when neither side had any", () => {
    const nb = makeMinimalNotebook([
      { cell_type: "markdown", id: CELL_CODE, source: "p", metadata: {} },
      { cell_type: "markdown", id: CELL_MD, source: "c", metadata: {} },
    ]);
    const result = joinCell(nb, CELL_MD);
    assertEquals("attachments" in result.cells[0], false);
  });

  it("keeps prev's attachments only on mixed-type joins (prev type wins)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_CODE,
        source: "p",
        attachments: { "x.png": { "image/png": "PREV" } },
        metadata: {},
      },
      {
        cell_type: "code",
        id: CELL_MD,
        source: "c",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = joinCell(nb, CELL_MD);
    const merged = result.cells[0];
    if (merged.cell_type === "markdown") {
      assertEquals(merged.attachments, {
        "x.png": { "image/png": "PREV" },
      });
    }
  });

  it("is immutable — input notebook reference is unchanged on a real join", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "y", metadata: {} },
    ]);
    const originalCells = nb.cells;
    const result = joinCell(nb, CELL_MD);
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    assertEquals(Object.is(nb.cells, originalCells), true);
    assertEquals(nb.cells.length, 2);
  });
});

// --- updateCellSource (europa.notebook.cell.update-source) ---

describe("updateCellSource", () => {
  it("replaces only the source field of the matching cell", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "print(1)",
        execution_count: 7,
        outputs: [],
        metadata: { tags: ["keep"] },
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = updateCellSource(nb, CELL_CODE, "print(2)\nprint(3)");
    assertEquals(result.cells[0].source, "print(2)\nprint(3)");
    assertEquals(result.cells[0].id, CELL_CODE);
    assertEquals(result.cells[0].cell_type, "code");
    assertEquals(result.cells[0].metadata, { tags: ["keep"] });
    if (result.cells[0].cell_type === "code") {
      assertEquals(result.cells[0].execution_count, 7);
      assertEquals(result.cells[0].outputs, []);
    }
  });

  it("leaves untouched cells with structural sharing", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = updateCellSource(nb, CELL_CODE, "x = 2");
    assertEquals(Object.is(result.cells[1], nb.cells[1]), true);
  });

  it("returns the same notebook reference when cellId is not found", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = updateCellSource(nb, "nonexistent-id", "x = 2");
    assertEquals(Object.is(nb, result), true);
  });

  it("is immutable — input notebook is not mutated", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const originalCells = nb.cells;
    const originalSource = nb.cells[0].source;
    const result = updateCellSource(nb, CELL_CODE, "x = 2");
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    assertEquals(Object.is(nb.cells, originalCells), true);
    assertEquals(nb.cells[0].source, originalSource);
  });

  it("supports an empty new source", () => {
    const nb = makeMinimalNotebook([
      { cell_type: "markdown", id: CELL_MD, source: "# heading", metadata: {} },
    ]);
    const result = updateCellSource(nb, CELL_MD, "");
    assertEquals(result.cells[0].source, "");
  });
});

// --- changeCellType (europa.notebook.cell.change-type) ---

describe("changeCellType", () => {
  it("code → markdown drops outputs and execution_count fields physically", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: 5,
        outputs: [{ output_type: "stream", name: "stdout", text: "hi" }],
        metadata: { tags: ["keep"] },
      },
    ]);
    const result = changeCellType(nb, CELL_CODE, "markdown");
    assertEquals(result.cells.length, 1);
    assertEquals(result.cells[0].cell_type, "markdown");
    assertEquals("outputs" in result.cells[0], false);
    assertEquals("execution_count" in result.cells[0], false);
    assertEquals(result.cells[0].source, "x = 1");
    assertEquals(result.cells[0].metadata, { tags: ["keep"] });
  });

  it("code → raw drops outputs and execution_count fields physically", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "print(1)",
        execution_count: 3,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, CELL_CODE, "raw");
    assertEquals(result.cells[0].cell_type, "raw");
    assertEquals("outputs" in result.cells[0], false);
    assertEquals("execution_count" in result.cells[0], false);
  });

  it("markdown → code initialises outputs=[] and execution_count=null", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "# heading",
        metadata: { collapsed: true },
      },
    ]);
    const result = changeCellType(nb, CELL_MD, "code");
    assertEquals(result.cells[0].cell_type, "code");
    assertEquals(result.cells[0].source, "# heading");
    assertEquals(result.cells[0].metadata, { collapsed: true });
    if (result.cells[0].cell_type === "code") {
      assertEquals(result.cells[0].outputs, []);
      assertEquals(result.cells[0].execution_count, null);
    }
  });

  it("raw → code initialises outputs=[] and execution_count=null", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "raw",
        id: CELL_RAW,
        source: "raw content",
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, CELL_RAW, "code");
    assertEquals(result.cells[0].cell_type, "code");
    if (result.cells[0].cell_type === "code") {
      assertEquals(result.cells[0].outputs, []);
      assertEquals(result.cells[0].execution_count, null);
    }
  });

  it("same type (code → code) returns the same notebook reference (no-op)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, CELL_CODE, "code");
    assertEquals(Object.is(nb, result), true);
  });

  it("same type (markdown → markdown) returns the same notebook reference (no-op)", () => {
    const nb = makeMinimalNotebook([
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = changeCellType(nb, CELL_MD, "markdown");
    assertEquals(Object.is(nb, result), true);
  });

  it("cellId not found returns the same notebook reference (no-op)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, "nonexistent-id", "markdown");
    assertEquals(Object.is(nb, result), true);
  });

  it("is immutable — input notebook reference is unchanged on a real type change", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const originalCells = nb.cells;
    const result = changeCellType(nb, CELL_CODE, "markdown");
    assertEquals(Object.is(nb, result), false);
    assertEquals(Object.is(nb.cells, result.cells), false);
    assertEquals(Object.is(nb.cells, originalCells), true);
    assertEquals(nb.cells[0].cell_type, "code");
  });

  it("preserves untouched cells via structural sharing", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "code",
        id: CELL_CODE,
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      { cell_type: "markdown", id: CELL_MD, source: "# md", metadata: {} },
    ]);
    const result = changeCellType(nb, CELL_CODE, "raw");
    assertEquals(Object.is(result.cells[1], nb.cells[1]), true);
  });
});
