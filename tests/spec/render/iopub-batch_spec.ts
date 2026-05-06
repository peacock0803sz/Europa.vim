/**
 * BDD specs for IopubBatchScheduler.
 *
 * Covers queue accumulation, 16ms tick scheduling, empty-batch skip,
 * immediate flush on execute_reply, and WS close-sync flush ordering.
 *
 * @spec-id europa.render.iopub-batch.queue-accumulate
 * @spec-id europa.render.iopub-batch.tick-scheduling
 * @spec-id europa.render.iopub-batch.empty-tick-skip
 * @spec-id europa.render.iopub-batch.reply-flush-immediate
 * @spec-id europa.render.iopub-batch.close-flush-sync
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

function makeStreamMsg(
  cellId = "cell-1",
  parentMsgId = "req-1",
): KernelMessage {
  return {
    header: {
      msg_id: crypto.randomUUID(),
      msg_type: "stream",
      username: "test",
      session: "s1",
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: { msg_id: parentMsgId },
    metadata: {},
    content: { name: "stdout", text: `output from ${cellId}` },
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

describe("IopubBatchScheduler", () => {
  let host: MockHost;

  beforeEach(() => {
    host = mockVim();
  });

  afterEach(() => {
    host.reset();
  });

  describe("enqueue / queue-accumulate", () => {
    it("(1) two enqueues followed by flushNow produces exactly one batch RPC call", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500, // long tick so timer doesn't fire during test
      });

      sched.enqueue(makeStreamMsg(), "cell-1");
      sched.enqueue(makeStreamMsg(), "cell-1");
      await sched.flushNow();
      await sched.dispose();

      const batchCalls = host.calls.filter((c) => c.method === "batch");
      assertEquals(batchCalls.length, 1);
    });
  });

  describe("tick-scheduling", () => {
    it("(2) first enqueue starts the timer; flush happens after tickMs", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 10,
      });

      sched.enqueue(makeStreamMsg(), "cell-1");
      // Wait longer than tickMs for the timer to fire naturally
      await new Promise((r) => setTimeout(r, 30));

      const batchCalls = host.calls.filter((c) => c.method === "batch");
      assertEquals(batchCalls.length, 1);
      await sched.dispose();
    });

    it("(7b) flush clears the pending timer before draining", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 100,
      });

      sched.enqueue(makeStreamMsg(), "cell-1");
      // Manual flush before timer fires
      await sched.flushNow();
      // Wait past tickMs to ensure no second batch fires from the (now-cancelled) timer
      await new Promise((r) => setTimeout(r, 150));

      const batchCalls = host.calls.filter((c) => c.method === "batch");
      assertEquals(batchCalls.length, 1); // only 1, not 2
      await sched.dispose();
    });
  });

  describe("empty-tick-skip", () => {
    it("(3) flushNow on empty queue makes no bufwinid or batch calls", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500,
      });

      await sched.flushNow();
      await sched.dispose();

      assertEquals(host.callsTo("bufwinid").length, 0);
      assertEquals(host.calls.filter((c) => c.method === "batch").length, 0);
    });
  });

  describe("reply-flush-immediate", () => {
    it("(5) flushNow called immediately after execute_reply drains all pending messages", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500,
      });

      for (let i = 0; i < 5; i++) {
        sched.enqueue(makeStreamMsg(), "cell-1");
      }
      // Simulate execute_reply path: immediate flush
      await sched.flushNow();

      const batchCalls = host.calls.filter((c) => c.method === "batch");
      assertEquals(batchCalls.length, 1);

      // After flush, a second flushNow should be a no-op (empty queue)
      host.calls = [];
      await sched.flushNow();
      assertEquals(host.calls.filter((c) => c.method === "batch").length, 0);

      await sched.dispose();
    });
  });

  describe("close-flush-sync", () => {
    it("(6) flushNow completes before the caller can continue (simulating WS onclose order)", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500,
      });

      sched.enqueue(makeStreamMsg(), "cell-1");

      const order: string[] = [];
      const flushPromise = sched.flushNow().then(() =>
        order.push("flush-done")
      );
      order.push("after-flush-call");
      await flushPromise;
      order.push("abort-called");

      // flush-done must precede abort-called
      assertEquals(order[0], "after-flush-call");
      assertEquals(order[1], "flush-done");
      assertEquals(order[2], "abort-called");

      await sched.dispose();
    });
  });

  describe("dispose lifecycle", () => {
    it("(11) dispose with 5 pending messages flushes them and prevents further enqueues", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500,
      });

      for (let i = 0; i < 5; i++) {
        sched.enqueue(makeStreamMsg(), "cell-1");
      }
      await sched.dispose();

      const batchCalls = host.calls.filter((c) => c.method === "batch");
      assertEquals(batchCalls.length, 1);

      // Post-dispose enqueue is a silent no-op
      host.calls = [];
      sched.enqueue(makeStreamMsg(), "cell-1");
      await new Promise((r) => setTimeout(r, 20));
      assertEquals(host.calls.filter((c) => c.method === "batch").length, 0);
    });

    it("(12) calling dispose multiple times does not throw", async () => {
      const nb = makeNotebook();
      const sched = createIopubBatchScheduler({
        denops: host,
        bufnr: 1,
        notebook: nb,
        caps,
        tickMs: 500,
      });

      await sched.dispose();
      await sched.dispose();
      await sched.dispose(); // third call must not throw
    });
  });
});
