/**
 * BDD specs for updateCellSource and changeCellType.
 *
 * @spec-id europa.notebook.cell.update-source
 * @spec-id europa.notebook.cell.change-type
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  changeCellType,
  updateCellSource,
} from "../../../../denops/europa/notebook/cell.ts";
import {
  CELL_CODE,
  CELL_MD,
  CELL_RAW,
  makeMinimalNotebook,
} from "./_helpers.ts";

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

  it("markdown → code drops attachments (raw/code cells do not carry the field)", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "![attachment:logo.png]",
        attachments: { "logo.png": { "image/png": "iVBORw0KGgo=" } },
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, CELL_MD, "code");
    assertEquals(result.cells[0].cell_type, "code");
    assertEquals("attachments" in result.cells[0], false);
  });

  it("markdown → raw drops attachments", () => {
    const nb = makeMinimalNotebook([
      {
        cell_type: "markdown",
        id: CELL_MD,
        source: "![attachment:logo.png]",
        attachments: { "logo.png": { "image/png": "iVBORw0KGgo=" } },
        metadata: {},
      },
    ]);
    const result = changeCellType(nb, CELL_MD, "raw");
    assertEquals(result.cells[0].cell_type, "raw");
    assertEquals("attachments" in result.cells[0], false);
  });
});
