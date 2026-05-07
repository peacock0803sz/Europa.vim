/**
 * BDD specs for splitCell and joinCell.
 *
 * @spec-id europa.notebook.cell.split
 * @spec-id europa.notebook.cell.join
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  isValidCellId,
  joinCell,
  splitCell,
} from "../../../../denops/europa/notebook/cell.ts";
import {
  CELL_CODE,
  CELL_MD,
  CELL_RAW,
  makeMinimalNotebook,
} from "./_helpers.ts";

// --- splitCell (europa.notebook.cell.split) ---

describe("splitCell", () => {
  function makeCodeCell(source: string) {
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
