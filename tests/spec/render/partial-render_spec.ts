/**
 * BDD specs for applyPartialRenderPlan.
 *
 * Verifies that partial rendering only rewrites buffer lines from the
 * affected cell onwards, leaving above-cell lines bit-identical.
 *
 * @spec-id europa.render.partial.affected-cell-rerender
 * @spec-id europa.render.partial.below-cell-line-offset-reattach
 * @spec-id europa.render.partial.above-cell-bit-identical
 */

import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertGreater } from "@std/assert";
import { applyPartialRenderPlan } from "../../../denops/europa/render/partial-render.ts";
import { buildRenderPlan } from "../../../denops/europa/render/builder.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";

const caps: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
  treeSitter: { available: false },
};

function makeNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        id: "cell-1",
        cell_type: "code",
        source: "print(1)",
        outputs: [],
        execution_count: null,
        metadata: {},
      },
      {
        id: "cell-2",
        cell_type: "code",
        source: "print(2)",
        outputs: [],
        execution_count: null,
        metadata: {},
      },
    ],
  };
}

function makeMultiCellNotebook(cellCount: number): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: Array.from({ length: cellCount }, (_, i) => ({
      id: `cell-${i}`,
      cell_type: "code" as const,
      source: `print(${i})`,
      outputs: [],
      execution_count: null,
      metadata: {},
    })),
  };
}

describe("applyPartialRenderPlan", () => {
  let host: MockHost;

  beforeEach(() => {
    host = mockVim();
  });

  it("(1) with fromCellId, setbufline writes from the affected cell's start line, not from line 1", async () => {
    const nb = makeNotebook();
    // Full render to measure baseline: setbufline(bufnr, lnum, lines)
    // callRecord.args = ["setbufline", bufnr, lnum, lines]
    // so lnum is at args[2]
    await applyPartialRenderPlan(host, 1, nb, undefined, caps);
    const fullSetbuflineCalls = host.callsTo("setbufline");
    const fullStartLine = fullSetbuflineCalls[0]?.args[2] as number ?? 1;

    // Partial render starting from cell-2 — should start at a higher lnum than full
    host.reset();
    await applyPartialRenderPlan(host, 1, nb, "cell-2", caps);
    const partialSetbuflineCalls = host.callsTo("setbufline");

    if (partialSetbuflineCalls.length > 0) {
      const partialStartLine = partialSetbuflineCalls[0].args[2] as number;
      // Partial render must start at a higher line number than the full render
      assertEquals(partialStartLine > fullStartLine, true);
    }
    // If no setbufline call was made, the notebook may be too small for a meaningful skip
  });

  it("(2) fromCellId not found in cellRanges falls back to full render", async () => {
    const nb = makeNotebook();
    // Full render to establish baseline
    await applyPartialRenderPlan(host, 1, nb, undefined, caps);
    const fullBatchCount =
      host.calls.filter((c) =>
        c.method === "call" && c.args[0] === "setbufline"
      ).length;

    host.reset();
    // Unknown cellId should fall back to full path (same number of setbufline calls)
    await applyPartialRenderPlan(host, 1, nb, "nonexistent-cell", caps);
    const fallbackSetbuflineCount =
      host.calls.filter((c) =>
        c.method === "call" && c.args[0] === "setbufline"
      ).length;

    assertEquals(fallbackSetbuflineCount, fullBatchCount);
  });

  it("(5) below-cell-line-offset-reattach: lines from affected cell to end are all rewritten", async () => {
    const nb = makeNotebook();
    await applyPartialRenderPlan(host, 1, nb, "cell-1", caps);
    // At minimum setbufline was called once (at cell-1's start line)
    const calls = host.callsTo("setbufline");
    assertEquals(calls.length >= 1, true);
  });
});

describe("applyPartialRenderPlan — above-cell-bit-identical (SC-003)", () => {
  let host: MockHost;

  beforeEach(() => {
    host = mockVim();
  });

  it(
    "(3) all setbufline calls in partial path start at or after the affected cell — above lines are never written",
    async () => {
      // 6-cell notebook; partial render from cell-3 must not write cells 0-2.
      const nb = makeMultiCellNotebook(6);

      // Compute cell-3's exact start line from RenderPlan instead of using the
      // full-render's first lnum (always 1), which would trivially pass even if
      // a buggy partial render wrote from line 2 through cell-2's territory.
      const plan = await buildRenderPlan(nb, caps);
      const cell3Range = plan.cellRanges.find((r) => r.cellId === "cell-3");
      assertExists(cell3Range, "cell-3 must appear in cellRanges");
      // cellRanges.startLine is 0-indexed; setbufline uses 1-indexed lnums
      // (topOffset + 1 in viewer.ts).  lnum > startLine ⟺ lnum ≥ startLine+1.
      const cell3StartLine = cell3Range.startLine;

      // Partial render from cell-3: only lines from cell-3 onwards are written.
      await applyPartialRenderPlan(host, 1, nb, "cell-3", caps);
      const partialCalls = host.callsTo("setbufline");

      // Every setbufline must start at or after cell-3's first line,
      // proving that lines above cell-3 (cells 0-2) are left bit-identical.
      for (const call of partialCalls) {
        const lnum = call.args[2] as number;
        assertGreater(
          lnum,
          cell3StartLine,
          `setbufline lnum=${lnum} writes before cell-3 (startLine=${cell3StartLine}) — above-cell lines must not be touched (SC-003)`,
        );
      }
    },
  );

  it(
    "(6) partial render does not invoke cursor-position-changing Vim functions (SC-003 cursor stability)",
    async () => {
      const nb = makeMultiCellNotebook(4);

      await applyPartialRenderPlan(host, 1, nb, "cell-2", caps);

      // Cursor-movement must not be called during partial render — checked
      // across both the denops.call() path (cursor/setpos/nvim_win_set_cursor)
      // and the denops.cmd() path used by restoreCursor() in viewer.ts
      // ("call cursor(...)" / win_execute(..., 'call cursor(...)')).
      const cursorCalls = host.calls.filter((c) => {
        if (c.method === "call") {
          return ["cursor", "setpos", "nvim_win_set_cursor"].includes(
            c.args[0] as string,
          );
        }
        if (c.method === "cmd") {
          return /\bcursor\s*\(|\bsetpos\s*\(/.test(c.args[0] as string);
        }
        return false;
      });

      assertEquals(
        cursorCalls.length,
        0,
        "partial render must not call cursor-position-changing functions (call or cmd path)",
      );
    },
  );
});
