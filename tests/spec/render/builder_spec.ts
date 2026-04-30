/**
 * BDD specs for buildRenderPlan.
 *
 * @spec-id europa.render.builder.assemble
 * @spec-id europa.render.builder.cell-ranges
 * @spec-id europa.render.builder.empty-notebook-guidance
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { buildRenderPlan } from "../../../denops/europa/render/builder.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";

const defaultCaps: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
};

function makeNotebook(cells: Notebook["cells"]): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  };
}

describe("buildRenderPlan", () => {
  it("returns a RenderPlan with lines and cellMap arrays", () => {
    const nb = makeNotebook([{
      cell_type: "code",
      id: "cell1",
      source: "x = 1",
      execution_count: 1,
      outputs: [],
      metadata: {},
    }]);
    const plan = buildRenderPlan(nb, defaultCaps);
    assertExists(plan.lines);
    assertExists(plan.cellMap);
    assertExists(plan.highlights);
  });

  it("produces one cellMap entry per cell", () => {
    const nb = makeNotebook([
      {
        cell_type: "code",
        id: "cell1",
        source: "a = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: "cell2",
        source: "# Hello",
        metadata: {},
      },
    ]);
    const plan = buildRenderPlan(nb, defaultCaps);
    assertEquals(plan.cellMap.length, 2);
  });

  it("includes source lines in the plan", () => {
    const nb = makeNotebook([{
      cell_type: "code",
      id: "cell1",
      source: "line1\nline2",
      execution_count: null,
      outputs: [],
      metadata: {},
    }]);
    const plan = buildRenderPlan(nb, defaultCaps);
    // source lines should appear somewhere in plan.lines
    const allLines = plan.lines.join("\n");
    assertEquals(allLines.includes("line1"), true);
    assertEquals(allLines.includes("line2"), true);
  });

  it("includes header decoration lines for each cell", () => {
    const nb = makeNotebook([{
      cell_type: "code",
      id: "cell1",
      source: "",
      execution_count: null,
      outputs: [],
      metadata: {},
    }]);
    const plan = buildRenderPlan(nb, defaultCaps);
    // At minimum, there should be more than just the empty source
    assertEquals(plan.lines.length >= 1, true);
  });

  it("cellMap records non-overlapping line ranges", () => {
    const nb = makeNotebook([
      {
        cell_type: "code",
        id: "cell1",
        source: "a",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
      {
        cell_type: "code",
        id: "cell2",
        source: "b",
        execution_count: null,
        outputs: [],
        metadata: {},
      },
    ]);
    const plan = buildRenderPlan(nb, defaultCaps);
    assertEquals(plan.cellMap.length, 2);
    // Second cell starts where first ends
    assertEquals(
      plan.cellMap[1].bufLineStart >= plan.cellMap[0].bufLineEnd,
      true,
    );
  });

  // FR-051 — output line cap is per-cell (not per-output) and includes the
  // `[... truncated, N more lines]` summary in the cap.
  // --- Phase 3.1: cellRanges ---

  describe("cellRanges (europa.render.builder.cell-ranges)", () => {
    it("single code cell has startLine=0 and endLine covers all emitted lines", () => {
      const nb = makeNotebook([{
        cell_type: "code",
        id: "cell-a",
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      }]);
      const plan = buildRenderPlan(nb, defaultCaps);
      assertEquals(plan.cellRanges.length, 1);
      assertEquals(plan.cellRanges[0].cellId, "cell-a");
      assertEquals(plan.cellRanges[0].startLine, 0);
      assertEquals(plan.cellRanges[0].endLine, plan.lines.length - 1);
    });

    it("consecutive cell ranges are contiguous (endLine[i] + 1 === startLine[i+1])", () => {
      const nb = makeNotebook([
        {
          cell_type: "code",
          id: "cell-1",
          source: "a = 1",
          execution_count: null,
          outputs: [],
          metadata: {},
        },
        {
          cell_type: "markdown",
          id: "cell-2",
          source: "# Hello",
          metadata: {},
        },
        {
          cell_type: "code",
          id: "cell-3",
          source: "b = 2",
          execution_count: null,
          outputs: [],
          metadata: {},
        },
      ]);
      const plan = buildRenderPlan(nb, defaultCaps);
      assertEquals(plan.cellRanges.length, 3);
      assertEquals(
        plan.cellRanges[0].endLine + 1,
        plan.cellRanges[1].startLine,
      );
      assertEquals(
        plan.cellRanges[1].endLine + 1,
        plan.cellRanges[2].startLine,
      );
    });

    it("startLine of a cell equals its header line index (boundary included)", () => {
      const nb = makeNotebook([{
        cell_type: "code",
        id: "cell-x",
        source: "x = 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      }]);
      const plan = buildRenderPlan(nb, defaultCaps);
      // The header line is emitted first, so startLine should match it
      assertEquals(plan.cellRanges[0].startLine, 0);
      // plan.lines[0] is the header "## [code] cell-x"
      assertEquals(plan.lines[0].includes("cell-x"), true);
    });

    it("empty notebook returns cellRanges=[] and 8 guidance lines", () => {
      const nb = makeNotebook([]);
      const plan = buildRenderPlan(nb, defaultCaps);
      assertEquals(plan.cellRanges.length, 0);
      assertEquals(plan.lines.length, 8);
      assertEquals(plan.lines[0], "[Empty notebook]");
      assertEquals(plan.lines[2], "This notebook has no cells.");
    });

    it("boundary lines are within the cell range (startLine and endLine)", () => {
      const nb = makeNotebook([
        {
          cell_type: "code",
          id: "first",
          source: "a",
          execution_count: null,
          outputs: [],
          metadata: {},
        },
        {
          cell_type: "code",
          id: "second",
          source: "b",
          execution_count: null,
          outputs: [],
          metadata: {},
        },
      ]);
      const plan = buildRenderPlan(nb, defaultCaps);
      const r0 = plan.cellRanges[0];
      const r1 = plan.cellRanges[1];
      // startLine of each range points to the header line
      assertEquals(plan.lines[r0.startLine].includes("first"), true);
      assertEquals(plan.lines[r1.startLine].includes("second"), true);
    });
  });

  describe("max_output_lines cap (FR-051)", () => {
    function streamOf(lineCount: number): Notebook["cells"][number] {
      const text = Array.from({ length: lineCount }, (_, i) => `L${i}`).join(
        "\n",
      );
      return {
        cell_type: "code",
        id: "cell1",
        source: "",
        execution_count: null,
        outputs: [{ output_type: "stream", name: "stdout", text }],
        metadata: {},
      };
    }

    it("does not truncate when total output lines fit within the cap", () => {
      const plan = buildRenderPlan(makeNotebook([streamOf(5)]), defaultCaps, {
        maxOutputLines: 10,
      });
      assertEquals(
        plan.lines.some((l) => l.startsWith("[... truncated")),
        false,
      );
    });

    it("caps total output lines at maxOutputLines including the summary", () => {
      // 10-line stream output, cap = 4 → 3 content + 1 summary = 4 total
      const plan = buildRenderPlan(makeNotebook([streamOf(10)]), defaultCaps, {
        maxOutputLines: 4,
      });
      const cell = plan.cellMap[0];
      // Cell layout for `source: ""`: header (1 line; source is falsy so no
      // source lines are emitted) + output lines. Skip the header to inspect
      // outputs.
      const outputLines = plan.lines.slice(
        cell.bufLineStart + 1,
        cell.bufLineEnd,
      );
      assertEquals(outputLines.length, 4);
      assertEquals(
        outputLines[outputLines.length - 1].startsWith("[..."),
        true,
      );
    });

    it("applies the cap per-cell across multiple outputs (not per-output)", () => {
      // Two outputs of 30 lines each = 60 total, cap = 20 → 19 content + 1 summary.
      // Per-output (buggy) interpretation would have produced 30 + 30 = 60 lines unchanged
      // or 20 + 20 = 40 — both clearly more than the per-cell budget of 20.
      const cell: Notebook["cells"][number] = {
        cell_type: "code",
        id: "cell1",
        source: "",
        execution_count: null,
        outputs: [
          {
            output_type: "stream",
            name: "stdout",
            text: Array.from({ length: 30 }, (_, i) => `A${i}`).join("\n"),
          },
          // Use a different stream name so mergeStreams keeps them separate.
          {
            output_type: "stream",
            name: "stderr",
            text: Array.from({ length: 30 }, (_, i) => `B${i}`).join("\n"),
          },
        ],
        metadata: {},
      };
      const plan = buildRenderPlan(makeNotebook([cell]), defaultCaps, {
        maxOutputLines: 20,
      });
      const cm = plan.cellMap[0];
      const outputLines = plan.lines.slice(cm.bufLineStart + 1, cm.bufLineEnd);
      assertEquals(outputLines.length, 20);
      // Summary mentions 60 - 19 = 41 missing lines
      assertEquals(
        outputLines[outputLines.length - 1],
        "[... truncated, 41 more lines]",
      );
    });
  });
});
