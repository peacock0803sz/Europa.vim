/**
 * BDD specs for the Phase 3.8 traceback line-jump helpers.
 *
 * Covers pure helpers (`findClickableAtCursor`, `rewriteMissingHighlights`,
 * `resolveFilePath`) and async executors (`jumpToCellLine`, `jumpToFile`)
 * exercised via the mockVim host. The dispatcher RPC integration is
 * covered by `tests/spec/dispatcher/jump-to-traceback_spec.ts`.
 *
 * @spec-id europa.view.traceback-jump.cell-line
 * @spec-id europa.view.traceback-jump.external-file
 * @spec-id europa.view.traceback-jump.missing-detection
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { mockNvim, mockVim } from "../../fixtures/mock-host.ts";
import {
  applyTracebackHighlights,
  findClickableAtCursor,
  jumpToCellLine,
  jumpToFile,
  makeNotebookSelector,
  resolveFilePath,
  rewriteMissingHighlights,
} from "../../../denops/europa/view/traceback-jump.ts";
import type { Clickable, RenderPlan } from "../../../schema/render-plan.ts";
import type { Notebook } from "../../../schema/notebook.ts";

function emptyPlan(overrides: Partial<RenderPlan> = {}): RenderPlan {
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
    mdDecorations: [],
    cellMap: [],
    cellRanges: [],
    ...overrides,
  };
}

describe("findClickableAtCursor", () => {
  const cellClickable: Clickable = {
    line: 5,
    colStart: 0,
    colEnd: 18,
    action: {
      type: "jump_to_cell_line",
      payload: { executionCount: 3, line: 5 },
    },
  };

  it("returns the matching clickable when cursor is inside its range (1-origin input)", () => {
    // Vim line=6 (1-origin), col=1 (1-origin) → 0-origin (5, 0) — inside [0, 18)
    const got = findClickableAtCursor([cellClickable], 6, 1);
    assertEquals(got, cellClickable);
  });

  it("matches at the right edge: cursorCol just inside colEnd", () => {
    // colEnd = 18 (exclusive). Vim col=18 (1-origin) → 0-origin col=17, still inside.
    const got = findClickableAtCursor([cellClickable], 6, 18);
    assertEquals(got, cellClickable);
  });

  it("returns null when cursorCol equals colEnd (half-open boundary)", () => {
    // col=19 (1-origin) → 0-origin 18 == colEnd → outside half-open range
    const got = findClickableAtCursor([cellClickable], 6, 19);
    assertEquals(got, null);
  });

  it("returns null when cursor line does not match", () => {
    const got = findClickableAtCursor([cellClickable], 5, 1);
    assertEquals(got, null);
  });

  it("returns null when clickables array is empty", () => {
    assertEquals(findClickableAtCursor([], 1, 1), null);
  });

  it("returns the first matching clickable when multiple cover the same point", () => {
    const a: Clickable = {
      line: 5,
      colStart: 0,
      colEnd: 18,
      action: { type: "open_url", payload: "https://a" },
    };
    const b: Clickable = {
      line: 5,
      colStart: 0,
      colEnd: 10,
      action: { type: "open_url", payload: "https://b" },
    };
    const got = findClickableAtCursor([a, b], 6, 1);
    assertEquals(got, a);
  });
});

describe("rewriteMissingHighlights", () => {
  it("downgrades EuropaErrorJump → EuropaErrorJumpMissing for non-actionable cell frames", () => {
    const plan = emptyPlan({
      clickables: [
        {
          line: 1,
          colStart: 0,
          colEnd: 18,
          action: {
            type: "jump_to_cell_line",
            payload: { executionCount: 99, line: 1 },
          },
        },
      ],
      highlights: [
        { hlGroup: "EuropaErrorJump", line: 1, col: 0, endCol: 18 },
      ],
    });
    rewriteMissingHighlights(plan, () => ({ actionable: false }));
    assertEquals(plan.highlights[0].hlGroup, "EuropaErrorJumpMissing");
  });

  it("leaves EuropaErrorJump untouched when the cell is actionable", () => {
    const plan = emptyPlan({
      clickables: [
        {
          line: 1,
          colStart: 0,
          colEnd: 18,
          action: {
            type: "jump_to_cell_line",
            payload: { executionCount: 3, line: 5 },
          },
        },
      ],
      highlights: [
        { hlGroup: "EuropaErrorJump", line: 1, col: 0, endCol: 18 },
      ],
    });
    rewriteMissingHighlights(plan, () => ({
      actionable: true,
      sourceStartLine: 0,
      sourceEndLine: 10,
    }));
    assertEquals(plan.highlights[0].hlGroup, "EuropaErrorJump");
  });

  it("never touches jump_to_file clickables (file existence is delegated to :split)", () => {
    const plan = emptyPlan({
      clickables: [
        {
          line: 2,
          colStart: 0,
          colEnd: 24,
          action: {
            type: "jump_to_file",
            payload: { path: "/missing/x.py", line: 1 },
          },
        },
      ],
      highlights: [
        { hlGroup: "EuropaErrorJump", line: 2, col: 0, endCol: 24 },
      ],
    });
    rewriteMissingHighlights(plan, () => ({ actionable: false }));
    assertEquals(plan.highlights[0].hlGroup, "EuropaErrorJump");
  });

  it("only rewrites highlights whose position matches the clickable", () => {
    const plan = emptyPlan({
      clickables: [
        {
          line: 1,
          colStart: 0,
          colEnd: 18,
          action: {
            type: "jump_to_cell_line",
            payload: { executionCount: 99, line: 1 },
          },
        },
      ],
      highlights: [
        // Same line but different col-range → should NOT be rewritten
        { hlGroup: "EuropaErrorJump", line: 1, col: 5, endCol: 10 },
        // Position match → should be rewritten
        { hlGroup: "EuropaErrorJump", line: 1, col: 0, endCol: 18 },
      ],
    });
    rewriteMissingHighlights(plan, () => ({ actionable: false }));
    assertEquals(plan.highlights[0].hlGroup, "EuropaErrorJump"); // untouched
    assertEquals(plan.highlights[1].hlGroup, "EuropaErrorJumpMissing");
  });
});

describe("jumpToCellLine", () => {
  it("moves cursor to sourceStartLine + K and centers viewport with zz", async () => {
    const host = mockVim();
    await jumpToCellLine(
      host,
      42,
      () => ({ found: true, sourceStartLine: 10, sourceEndLine: 20 }),
      { payload: { executionCount: 3, line: 5 } },
    );
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos('.', [42, 15, 1, 0])"),
    );
    assertEquals(setposCmd !== undefined, true);
    const zzCmd = host.calls.find(
      (c) => c.method === "cmd" && c.args[0] === "normal! zz",
    );
    assertEquals(zzCmd !== undefined, true);
  });

  it("is a silent no-op when the cell is not found", async () => {
    const host = mockVim();
    await jumpToCellLine(
      host,
      42,
      () => ({ found: false }),
      { payload: { executionCount: 99, line: 1 } },
    );
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });

  it("is a silent no-op when K is out of range (above)", async () => {
    const host = mockVim();
    await jumpToCellLine(
      host,
      42,
      () => ({ found: true, sourceStartLine: 0, sourceEndLine: 5 }),
      { payload: { executionCount: 3, line: 999 } },
    );
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });

  it("is a silent no-op when K is < 1", async () => {
    const host = mockVim();
    await jumpToCellLine(
      host,
      42,
      () => ({ found: true, sourceStartLine: 0, sourceEndLine: 5 }),
      { payload: { executionCount: 3, line: 0 } },
    );
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });
});

describe("resolveFilePath", () => {
  it("returns absolute paths as-is", () => {
    assertEquals(
      resolveFilePath("/abs/x.py", "/home/u/proj"),
      "/abs/x.py",
    );
  });

  it("expands leading ~ via HOME", () => {
    const orig = Deno.env.get("HOME");
    Deno.env.set("HOME", "/home/test");
    try {
      assertEquals(
        resolveFilePath("~/x.py", "/home/u/proj"),
        "/home/test/x.py",
      );
    } finally {
      if (orig !== undefined) Deno.env.set("HOME", orig);
      else Deno.env.delete("HOME");
    }
  });

  it("resolves relative paths against kernel cwd", () => {
    assertEquals(
      resolveFilePath("./util.py", "/home/u/proj"),
      "/home/u/proj/util.py",
    );
    assertEquals(
      resolveFilePath("util.py", "/home/u/proj"),
      "/home/u/proj/util.py",
    );
  });
});

describe("makeNotebookSelector", () => {
  const notebook: Notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        cell_type: "code",
        id: "code-3",
        source: "x = 1\ny = 2\nz = 3\n",
        execution_count: 3,
        outputs: [],
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: "md-1",
        source: "# heading",
        metadata: {},
      },
    ],
  };
  const cellSourceRanges = [
    {
      cellId: "code-3",
      kind: "code" as const,
      sourceStartLine: 10,
      sourceEndLine: 13,
    },
    {
      cellId: "md-1",
      kind: "markdown" as const,
      sourceStartLine: 14,
      sourceEndLine: 15,
    },
  ];

  it("returns actionable when cell exists and K is within source length", () => {
    const sel = makeNotebookSelector(notebook, cellSourceRanges);
    const r = sel(3, 2);
    assertEquals(r.actionable, true);
    if (r.actionable) {
      assertEquals(r.sourceStartLine, 10);
      assertEquals(r.sourceEndLine, 13);
    }
  });

  it("returns non-actionable when no cell has the matching execution_count", () => {
    const sel = makeNotebookSelector(notebook, cellSourceRanges);
    assertEquals(sel(99, 1).actionable, false);
  });

  it("returns non-actionable when K exceeds source length", () => {
    const sel = makeNotebookSelector(notebook, cellSourceRanges);
    // sourceEndLine - sourceStartLine = 3 → K must be 1..3
    assertEquals(sel(3, 4).actionable, false);
  });

  it("returns non-actionable when K is less than 1", () => {
    const sel = makeNotebookSelector(notebook, cellSourceRanges);
    assertEquals(sel(3, 0).actionable, false);
  });

  it("returns non-actionable when cellSourceRanges is undefined", () => {
    const sel = makeNotebookSelector(notebook, undefined);
    assertEquals(sel(3, 1).actionable, false);
  });

  it("skips markdown cells (cell_type === 'code' filter)", () => {
    const sel = makeNotebookSelector(
      {
        ...notebook,
        cells: [{ ...notebook.cells[1], execution_count: 3 } as never],
      },
      cellSourceRanges,
    );
    assertEquals(sel(3, 1).actionable, false);
  });
});

describe("applyTracebackHighlights", () => {
  function planWith(highlights: RenderPlan["highlights"]): RenderPlan {
    return {
      lines: [],
      highlights,
      virtText: [],
      imagePlacements: [],
      clickables: [],
      mdDecorations: [],
      cellMap: [],
      cellRanges: [],
    };
  }

  it("Neovim: clears the namespace then emits one extmark per traceback hl", async () => {
    const host = mockNvim();
    const plan = planWith([
      { hlGroup: "EuropaErrorJump", line: 1, col: 0, endCol: 18 },
      { hlGroup: "EuropaError", line: 1, col: 0, endCol: -1 },
      { hlGroup: "EuropaErrorJumpMissing", line: 5, col: 2, endCol: 22 },
    ]);
    await applyTracebackHighlights(host, 42, plan);
    const clears = host.callsTo("nvim_buf_clear_namespace");
    assertEquals(clears.length, 1);
    const extmarks = host.callsTo("nvim_buf_set_extmark");
    // Only the two traceback hls — EuropaError is filtered out
    assertEquals(extmarks.length, 2);
    // Priority 200 (R2 Neovim convention)
    const opts1 = extmarks[0].args[5] as Record<string, unknown>;
    assertEquals(opts1.priority, 200);
    assertEquals(opts1.hl_group, "EuropaErrorJump");
    assertEquals(opts1.end_col, 18);
  });

  it("Vim: prop_remove for each type then prop_add per highlight", async () => {
    const host = mockVim();
    const plan = planWith([
      { hlGroup: "EuropaErrorJump", line: 1, col: 0, endCol: 18 },
      { hlGroup: "EuropaErrorJumpMissing", line: 5, col: 2, endCol: 22 },
    ]);
    await applyTracebackHighlights(host, 42, plan);
    const removes = host.callsTo("prop_remove");
    assertEquals(removes.length, 2); // one per type
    const adds = host.callsTo("prop_add");
    assertEquals(adds.length, 2);
    // Vim uses line+1 / col+1 (1-origin); priority 100 (R2 Vim reversal)
    const firstAdd = adds[0];
    assertEquals(firstAdd.args[1], 2); // line 1 → 2
    assertEquals(firstAdd.args[2], 1); // col 0 → 1
    const opts = firstAdd.args[3] as Record<string, unknown>;
    assertEquals(opts.type, "EuropaErrorJump");
    assertEquals(opts.length, 18);
    assertEquals(opts.priority, 100);
  });

  it("emits nothing when no traceback highlights are present", async () => {
    const host = mockNvim();
    const plan = planWith([
      { hlGroup: "EuropaError", line: 1, col: 0, endCol: -1 },
    ]);
    await applyTracebackHighlights(host, 42, plan);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 0);
  });
});

describe("jumpToFile", () => {
  it("opens a :split for the resolved path and centers viewport", async () => {
    const host = mockVim();
    await jumpToFile(
      host,
      "/home/u/proj",
      { payload: { path: "/abs/x.py", line: 42 } },
    );
    const splitCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).startsWith("split "),
    );
    assertEquals(splitCmd !== undefined, true);
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos('.', [bufnr('%'), 42, 1, 0])"),
    );
    assertEquals(setposCmd !== undefined, true);
    const zzCmd = host.calls.find(
      (c) => c.method === "cmd" && c.args[0] === "normal! zz",
    );
    assertEquals(zzCmd !== undefined, true);
  });
});
