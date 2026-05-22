/**
 * Regression specs for `IopubBatchScheduler.onPlanApplied` callback.
 *
 * Background: PR#49 added tree-sitter syntax highlighting whose
 * `cellSourceRanges` live in `sessionStore.getRenderPlan(bufnr)`. The streaming
 * flush path (`_runFlush` → `applyPartialRenderPlan`) rebuilds a fresh
 * `RenderPlan` per flush but never wrote it back into the session, so the
 * cached plan drifted and tree-sitter extmarks were placed at stale rows
 * after the first cell execution. The fix routes the freshly built plan
 * through the optional `onPlanApplied` callback so dispatcher-level code
 * (`dispatcher/kernel.ts`) can call `sessionStore.setRenderPlan` +
 * `scheduleHighlightRefresh`.
 *
 * These specs lock in the callback contract at the scheduler level:
 *  - normal flush → callback fires once with the new plan
 *  - empty queue → no callback (no flush happened)
 *  - hidden buffer → no callback (flush short-circuits)
 *  - applyPartialRenderPlan throws → no callback (error is swallowed)
 *
 * @spec-id europa.render.iopub-batch.plan-applied-callback
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { createIopubBatchScheduler } from "../../../denops/europa/render/iopub-batch.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";
import type { KernelMessage } from "../../../schema/message.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

function makeStreamMsg(cellId = "cell-1"): KernelMessage {
  return {
    header: {
      msg_id: crypto.randomUUID(),
      msg_type: "stream",
      username: "test",
      session: "s1",
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: { msg_id: "req-1" },
    metadata: {},
    content: { name: "stdout", text: `output from ${cellId}\n` },
    buffers: [],
  };
}

function makeNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        id: "cell-1",
        cell_type: "code",
        source: "print('hi')",
        outputs: [],
        execution_count: null,
        metadata: {},
      },
    ],
  };
}

const caps: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
  treeSitter: { available: false },
};

describe("IopubBatchScheduler — onPlanApplied (europa.render.iopub-batch.plan-applied-callback)", () => {
  let host: MockHost;

  beforeEach(() => {
    host = mockVim();
  });

  afterEach(() => {
    host.reset();
  });

  it("normal flush — callback fires exactly once with the new RenderPlan", async () => {
    const nb = makeNotebook();
    const received: RenderPlan[] = [];
    const sched = createIopubBatchScheduler({
      denops: host,
      bufnr: 1,
      getNotebook: () => nb,
      caps,
      tickMs: 500, // long tick so no auto-fire
      onPlanApplied: (plan) => {
        received.push(plan);
      },
    });

    sched.enqueue(makeStreamMsg(), "cell-1");
    await sched.flushNow();
    await sched.dispose();

    assertEquals(
      received.length,
      1,
      "onPlanApplied must fire exactly once per successful flush",
    );
    const plan = received[0]!;
    // The plan must reflect the current notebook: 1 cell with source ranges.
    // cellSourceRanges is Optional in the schema; tree-sitter highlight only
    // works when builder populates it, so we assert it is present and shaped.
    assert(
      plan.cellSourceRanges !== undefined,
      "received plan must carry cellSourceRanges from the live notebook",
    );
    const ranges = plan.cellSourceRanges!;
    assertEquals(ranges.length, 1);
    assertEquals(ranges[0]!.kind, "code");
  });

  it("empty queue — flushNow short-circuits, callback never fires", async () => {
    const nb = makeNotebook();
    let calls = 0;
    const sched = createIopubBatchScheduler({
      denops: host,
      bufnr: 1,
      getNotebook: () => nb,
      caps,
      tickMs: 500,
      onPlanApplied: () => {
        calls += 1;
      },
    });

    await sched.flushNow();
    await sched.dispose();

    assertEquals(
      calls,
      0,
      "no flush ran (empty queue), so the callback must not fire",
    );
  });

  it("hidden buffer — flush early-returns at bufwinid check, callback never fires", async () => {
    const nb = makeNotebook();
    let calls = 0;
    // Hidden buffer: bufwinid returns -1, _runFlush early-returns before
    // applyPartialRenderPlan. cell.outputs are still updated by the execute
    // loop (applyMessageToCell), but no plan is built, so no callback.
    host.bufwinidResult = -1;
    const sched = createIopubBatchScheduler({
      denops: host,
      bufnr: 1,
      getNotebook: () => nb,
      caps,
      tickMs: 500,
      onPlanApplied: () => {
        calls += 1;
      },
    });

    sched.enqueue(makeStreamMsg(), "cell-1");
    await sched.flushNow();
    await sched.dispose();

    assertEquals(
      calls,
      0,
      "hidden buffer must skip the callback; BufWinEnter re-render covers re-show",
    );
  });

  it("flush path throws — F-error swallows it, callback never fires", async () => {
    let calls = 0;
    // Force _runFlush to throw at the getNotebook() call (line 139 in
    // iopub-batch.ts). The outer try/catch ("F-error") absorbs it so the
    // execute loop survives; the callback must not run because no plan
    // was successfully applied.
    const sched = createIopubBatchScheduler({
      denops: host,
      bufnr: 1,
      getNotebook: () => {
        throw new Error("forced failure");
      },
      caps,
      tickMs: 500,
      onPlanApplied: () => {
        calls += 1;
      },
    });

    sched.enqueue(makeStreamMsg(), "cell-1");
    await sched.flushNow();
    await sched.dispose();

    assertEquals(
      calls,
      0,
      "error in the flush path must not fire the callback (plan was not applied)",
    );
  });
});
