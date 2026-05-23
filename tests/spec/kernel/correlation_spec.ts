/**
 * BDD specs for the pendingRequests state machine helpers.
 *
 * Tests enqueue / markSent / complete / cancelQueued / abortAll
 * as defined in `contracts/pending-requests.md`.
 *
 * @spec-id europa.kernel.correlation.cross-buffer-drop
 * @spec-id europa.kernel.correlation.pending-state-queued-to-sent
 * @spec-id europa.kernel.correlation.pending-remove-on-reply
 * @spec-id europa.kernel.correlation.parent-header-filter
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";
import {
  abortAll,
  cancelQueued,
  complete,
  enqueue,
  markSent,
} from "../../../denops/europa/session/pending-requests.ts";

function makeRuntime(): KernelRuntime {
  return {
    client: {} as KernelRuntime["client"],
    serverKey: "local:/usr/bin/jupyter",
    info: {
      kernelId: "kernel-test-id",
      sessionId: "session-test-id",
      kernelName: "python3",
      connectionMode: "server",
      state: "idle",
      subprotocol: "v1",
      startedAt: new Date().toISOString(),
    },
    socket: {} as WebSocket,
    abort: new AbortController(),
    pendingRequests: new Map(),
    execState: "idle",
    cellStates: new Map(),
    cwd: "/tmp/europa-test",
  };
}

describe("enqueue", () => {
  it("(a) sets state='queued' and registers in pendingRequests", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    assertEquals(rt.pendingRequests.has(msgId), true);
    assertEquals(rt.pendingRequests.get(msgId)?.state, "queued");
    assertEquals(rt.pendingRequests.get(msgId)?.cellId, "cell-a");
  });

  it("(a) sets cellStates[cellId] = 'queued' on enqueue", () => {
    const rt = makeRuntime();
    enqueue(rt, 1, "cell-b");
    assertEquals(rt.cellStates.get("cell-b"), "queued");
  });

  it("returns a non-empty msgId string", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-c");
    assertEquals(typeof msgId, "string");
    assertEquals(msgId.length > 0, true);
  });

  it("sentAt is null on enqueue (not yet sent)", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-d");
    assertEquals(rt.pendingRequests.get(msgId)?.sentAt, null);
  });
});

describe("markSent", () => {
  it("(b) queued → sent one-way transition", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    assertEquals(rt.pendingRequests.get(msgId)?.state, "sent");
  });

  it("(b) sets cellStates[cellId] = 'busy' on markSent", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    assertEquals(rt.cellStates.get("cell-a"), "busy");
  });

  it("(b) sentAt is set to a number after markSent", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    const before = Date.now();
    markSent(rt, msgId);
    const sentAt = rt.pendingRequests.get(msgId)?.sentAt;
    assertEquals(typeof sentAt, "number");
    assertEquals((sentAt as number) >= before, true);
  });

  it("(b) re-calling markSent on 'sent' entry throws (monotonic invariant)", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    assertThrows(() => markSent(rt, msgId), Error, "invalid state transition");
  });

  it("markSent on missing msgId throws", () => {
    const rt = makeRuntime();
    assertThrows(() => markSent(rt, "nonexistent"), Error, "not found");
  });
});

describe("complete", () => {
  it("(c) removes entry from pendingRequests", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    complete(rt, msgId);
    assertEquals(rt.pendingRequests.has(msgId), false);
  });

  it("(c) sets cellStates[cellId] = 'idle' on complete", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    complete(rt, msgId);
    assertEquals(rt.cellStates.get("cell-a"), "idle");
  });

  it("complete is idempotent (no-op on already-removed entry)", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    complete(rt, msgId);
    complete(rt, msgId); // second call should not throw
    assertEquals(rt.pendingRequests.has(msgId), false);
  });

  it("complete does not clobber 'aborted' cellState", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-a");
    markSent(rt, msgId);
    // Simulate interrupt: set aborted before complete
    rt.cellStates.set("cell-a", "aborted");
    complete(rt, msgId);
    // aborted should be preserved since cell was not 'busy' when complete ran
    assertEquals(rt.cellStates.get("cell-a"), "aborted");
  });
});

describe("cancelQueued", () => {
  it("(d) drops queued entry and returns true", () => {
    const rt = makeRuntime();
    enqueue(rt, 1, "cell-q");
    const result = cancelQueued(rt, "cell-q");
    assertEquals(result, true);
    assertEquals(rt.pendingRequests.size, 0);
  });

  it("(d) sets cellStates to idle after cancel", () => {
    const rt = makeRuntime();
    enqueue(rt, 1, "cell-q");
    cancelQueued(rt, "cell-q");
    assertEquals(rt.cellStates.get("cell-q"), "idle");
  });

  it("(d) does not touch sent entries — returns false", () => {
    const rt = makeRuntime();
    const msgId = enqueue(rt, 1, "cell-s");
    markSent(rt, msgId);
    const result = cancelQueued(rt, "cell-s");
    assertEquals(result, false);
    assertEquals(rt.pendingRequests.has(msgId), true); // still there
  });

  it("(d) returns false for nonexistent cellId", () => {
    const rt = makeRuntime();
    const result = cancelQueued(rt, "no-such-cell");
    assertEquals(result, false);
  });
});

describe("abortAll", () => {
  it("(e) clears all pendingRequests", () => {
    const rt = makeRuntime();
    enqueue(rt, 1, "cell-1");
    enqueue(rt, 1, "cell-2");
    abortAll(rt);
    assertEquals(rt.pendingRequests.size, 0);
  });

  it("(e) sets all cellStates to 'aborted'", () => {
    const rt = makeRuntime();
    enqueue(rt, 1, "cell-x");
    enqueue(rt, 1, "cell-y");
    abortAll(rt);
    assertEquals(rt.cellStates.get("cell-x"), "aborted");
    assertEquals(rt.cellStates.get("cell-y"), "aborted");
  });

  it("(e) works on empty pendingRequests without error", () => {
    const rt = makeRuntime();
    abortAll(rt); // should not throw
    assertEquals(rt.pendingRequests.size, 0);
  });
});

describe("cross-buffer isolation (SC-005 gate)", () => {
  it("(f) 1000 enqueues produce unique msgIds", () => {
    const rt = makeRuntime();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = enqueue(rt, 1, `cell-${i}`);
      assertEquals(ids.has(id), false, `duplicate msgId at iteration ${i}`);
      ids.add(id);
      // Clean up so next enqueue doesn't accumulate
      cancelQueued(rt, `cell-${i}`);
    }
    assertEquals(ids.size, 1000);
  });

  it("(f) two runtimes' pendingRequests never cross-contaminate", () => {
    const rt1 = makeRuntime();
    const rt2 = makeRuntime();
    const id1 = enqueue(rt1, 1, "cell-a");
    const id2 = enqueue(rt2, 2, "cell-b");
    // rt1 does not contain rt2's msgId
    assertEquals(rt1.pendingRequests.has(id2), false);
    assertEquals(rt2.pendingRequests.has(id1), false);
  });
});
