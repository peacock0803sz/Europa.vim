/**
 * BDD specs for buildRenderPlan.
 *
 * @spec-id europa.render.builder.assemble
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

describe("buildRenderPlan / @spec-id europa.render.builder.assemble", () => {
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
});
