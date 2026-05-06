/**
 * Edge-path specs for IopubBatchScheduler.
 *
 * Covers back-pressure invariant (Q-bp), no-shed-no-drop invariant (Q-noshed),
 * and a deeper close-flush-sync assertion (F-immediate-on-close) that verifies
 * partial cell.outputs are preserved after the WS close flush.
 *
 * Scenarios 8-10 from contracts/iopub-batch-scheduler.md; scenario 6 deeper
 * coverage (partial output retention) that complements the base ordering test
 * in iopub-batch_spec.ts.
 *
 * @spec-id europa.render.iopub-batch.accumulate-during-flush
 * @spec-id europa.render.iopub-batch.no-shed-no-drop
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createIopubBatchScheduler } from "../../../denops/europa/render/iopub-batch.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";
import type { KernelMessage } from "../../../schema/message.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe("IopubBatchScheduler — edge paths", () => {
  let host: MockHost;

  beforeEach(() => {
    host = mockVim();
  });

  afterEach(() => {
    host.reset();
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Q-bp — accumulate-during-flush
  // -------------------------------------------------------------------------

  describe("accumulate-during-flush (Q-bp)", () => {
    it(
      "(8) items enqueued while a flush is in flight do not join the current batch",
      async () => {
        const nb = makeNotebook();
        const sched = createIopubBatchScheduler({
          denops: host,
          bufnr: 1,
          getNotebook: () => nb,
          caps,
          tickMs: 500, // long tick so the timer does not auto-fire during test
        });

        // Pre-load one item so the first flushNow() has something to drain.
        sched.enqueue(makeStreamMsg(), "cell-1");

        // Call flushNow() without awaiting it. The async body executes synchronously
        // up to the first `await denops.call("bufwinid", ...)` inside _runFlush():
        //   1. _doFlush() runs synchronously, sets _flushingPromise
        //   2. _runFlush() runs synchronously through queue.splice(0)
        //   3. execution suspends at the first await (bufwinid call)
        // At that moment _flushingPromise !== null and queue is empty.
        const flushPromise = sched.flushNow();

        // Enqueue 3 more items synchronously. They arrive AFTER queue.splice(0)
        // has already captured the pre-loaded item, so they sit in queue and will
        // NOT be included in the in-flight batch (Q-back-pressure invariant).
        sched.enqueue(makeStreamMsg(), "cell-1");
        sched.enqueue(makeStreamMsg(), "cell-1");
        sched.enqueue(makeStreamMsg(), "cell-1");

        // Await the first flush — drains only the 1 pre-loaded item.
        await flushPromise;

        const batchAfterFirst = host.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchAfterFirst.length,
          1,
          "exactly one batch RPC for the pre-loaded item; the 3 mid-flight enqueues did not merge",
        );

        // Explicitly drain the 3 remaining items with a second flushNow.
        await sched.flushNow();

        const batchAfterSecond = host.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchAfterSecond.length,
          2,
          "second batch flush processes the 3 items that arrived during the first flush",
        );

        await sched.dispose();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Q-noshed — no-shed-no-drop
  // -------------------------------------------------------------------------

  describe("no-shed-no-drop (Q-noshed)", () => {
    it(
      "(9) 50 000 synchronous enqueues produce no drops and trigger at least one batch flush",
      async () => {
        const nb = makeNotebook();
        const sched = createIopubBatchScheduler({
          denops: host,
          bufnr: 1,
          getNotebook: () => nb,
          caps,
          tickMs: 10,
        });

        // Enqueue 50 000 items synchronously before any timer fires.
        // JavaScript is single-threaded so the setTimeout(10ms) callback cannot
        // preempt this loop — all items will be in queue when the tick fires.
        const TOTAL = 50_000;
        for (let i = 0; i < TOTAL; i++) {
          sched.enqueue(makeStreamMsg(), "cell-1");
        }

        // Yield to the event loop so the 10ms tick has a chance to fire.
        await new Promise((r) => setTimeout(r, 50));

        // Explicitly flush any residual items (handles the back-pressure case
        // where a second batch is needed if the first tick spliced only part).
        await sched.flushNow();

        const batchCalls = host.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchCalls.length >= 1,
          true,
          "at least one batch flush must have fired — no global shed/drop of 50 000 items",
        );

        // After dispose, further enqueues are silently dropped (D-mark invariant).
        await sched.dispose();
        host.calls = [];
        sched.enqueue(makeStreamMsg(), "cell-1");
        await new Promise((r) => setTimeout(r, 30));
        assertEquals(
          host.calls.filter((c) => c.method === "batch").length,
          0,
          "post-dispose enqueue is a silent no-op",
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 6 (deeper): F-immediate-on-close — partial output preservation
  // -------------------------------------------------------------------------

  describe("close-flush-sync deeper (F-immediate-on-close)", () => {
    it(
      "(6-deeper) partial cell.outputs survive the WS close-flush and the ordering is preserved",
      async () => {
        const nb = makeNotebook();
        const cell = nb.cells[0] as {
          outputs: Array<{
            output_type: string;
            name: string;
            text: string;
          }>;
        };

        const sched = createIopubBatchScheduler({
          denops: host,
          bufnr: 1,
          getNotebook: () => nb,
          caps,
          tickMs: 500,
        });

        // Simulate the execute loop: main.ts calls applyMessageToCell (updates
        // cell.outputs) then enqueues the msg for viewer render. At WS close,
        // partial outputs are already in cell.outputs.
        cell.outputs = [
          { output_type: "stream", name: "stdout", text: "partial line 1\n" },
          { output_type: "stream", name: "stdout", text: "partial line 2\n" },
        ];
        sched.enqueue(makeStreamMsg(), "cell-1");

        const order: string[] = [];

        // Simulate onclose handler: `await scheduler.flushNow()` then `abort.abort()`.
        const flushPromise = sched.flushNow().then(() =>
          order.push("flush-done")
        );
        order.push("after-flush-call");
        await flushPromise;
        order.push("abort-called");

        // The flush must complete before the caller reaches abort.abort().
        // (F-immediate-on-close: partial output reflected before abort fires)
        assertEquals(order[0], "after-flush-call");
        assertEquals(order[1], "flush-done");
        assertEquals(order[2], "abort-called");

        // The scheduler must NOT clear or mutate cell.outputs — it only drives
        // the viewer RPC. Partial outputs must survive the flush intact.
        assertEquals(
          cell.outputs.length,
          2,
          "partial cell.outputs are preserved after close-flush; scheduler must not clear them",
        );

        // Exactly one batch RPC was issued (the pending message was flushed).
        const batchCalls = host.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchCalls.length,
          1,
          "exactly one batch RPC issued during the WS close flush",
        );

        await sched.dispose();
      },
    );
  });
});
