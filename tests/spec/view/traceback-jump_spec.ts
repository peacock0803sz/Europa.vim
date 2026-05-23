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
import { mockVim } from "../../fixtures/mock-host.ts";
import {
  findClickableAtCursor,
  jumpToCellLine,
  jumpToFile,
  resolveFilePath,
  rewriteMissingHighlights,
} from "../../../denops/europa/view/traceback-jump.ts";
import type { Clickable, RenderPlan } from "../../../schema/render-plan.ts";

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
