/**
 * BDD specs for SessionStore.
 *
 * @spec-id europa.session.state.store
 * @spec-id europa.session.state.cell-edit-buffers
 * @spec-id europa.session.state.render-plan-cache
 * @spec-id europa.session.state.kernel-runtime-set
 * @spec-id europa.session.state.kernel-runtime-update
 * @spec-id europa.session.state.kernel-runtime-remove
 * @spec-id europa.session.state.by-kernel-many
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { SessionStore } from "../../../denops/europa/session/state.ts";
import type { Session } from "../../../schema/session.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";

function makeSession(bufnr: number): Session {
  return {
    id: `00000000-0000-4000-a000-00000000000${bufnr}`,
    bufnr,
    notebookPath: `/tmp/test${bufnr}.ipynb`,
    notebook: {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [],
    },
    cellMap: [],
  };
}

let store: SessionStore;

describe("SessionStore", () => {
  beforeEach(() => {
    store = new SessionStore();
  });

  it("get returns undefined for unknown bufnr", () => {
    assertEquals(store.get(99), undefined);
  });

  it("add then get returns the session", () => {
    const s = makeSession(1);
    store.add(s);
    assertEquals(store.get(1), s);
  });

  it("update merges a partial patch", () => {
    store.add(makeSession(2));
    store.update(2, { notebookPath: "/new/path.ipynb" });
    assertEquals(store.get(2)?.notebookPath, "/new/path.ipynb");
    assertEquals(store.get(2)?.bufnr, 2);
  });

  it("update is a no-op for unknown bufnr", () => {
    store.update(99, { notebookPath: "/x" });
    assertEquals(store.get(99), undefined);
  });

  it("remove deletes the session", () => {
    store.add(makeSession(3));
    store.remove(3);
    assertEquals(store.get(3), undefined);
  });

  it("byKernel returns empty array in Phase 2", () => {
    store.add(makeSession(4));
    assertEquals(store.byKernel("kernel-abc"), []);
  });

  it("all returns all sessions", () => {
    store.add(makeSession(5));
    store.add(makeSession(6));
    assertEquals(store.all().length, 2);
  });

  it("all returns empty array when store is empty", () => {
    assertEquals(store.all(), []);
  });
});

// --- Phase 3.1: cellEditBuffers map (europa.session.state.cell-edit-buffers) ---

describe("SessionStore — cellEditBuffers map", () => {
  const viewerBufnr = 10;
  const cellId = "cell-abc";
  const scratchBufnr = 200;

  beforeEach(() => {
    store = new SessionStore();
    store.add(makeSession(viewerBufnr));
  });

  it("setCellEditBuffer records cellId → scratchBufnr", () => {
    store.setCellEditBuffer(viewerBufnr, cellId, scratchBufnr);
    const reverse = store.findViewerByScratchBufnr(scratchBufnr);
    assertEquals(reverse?.viewerBufnr, viewerBufnr);
    assertEquals(reverse?.cellId, cellId);
  });

  it("removeCellEditBuffer clears only the specified cellId", () => {
    store.setCellEditBuffer(viewerBufnr, cellId, scratchBufnr);
    store.setCellEditBuffer(viewerBufnr, "other-cell", 201);
    store.removeCellEditBuffer(viewerBufnr, cellId);
    assertEquals(store.findViewerByScratchBufnr(scratchBufnr), undefined);
    // other-cell remains
    assertEquals(store.findViewerByScratchBufnr(201)?.cellId, "other-cell");
  });

  it("findViewerByScratchBufnr returns undefined for unknown scratch bufnr", () => {
    assertEquals(store.findViewerByScratchBufnr(9999), undefined);
  });

  it("all cellEditBuffers are cleared when the session is removed", () => {
    store.setCellEditBuffer(viewerBufnr, cellId, scratchBufnr);
    store.remove(viewerBufnr);
    assertEquals(store.findViewerByScratchBufnr(scratchBufnr), undefined);
  });
});

// --- Phase 3.1: renderPlan cache (europa.session.state.render-plan-cache) ---

describe("SessionStore — renderPlan cache", () => {
  const viewerBufnr = 20;

  function makePlan(): RenderPlan {
    return {
      lines: ["line0"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [],
      cellRanges: [{ cellId: "cell-x", startLine: 0, endLine: 0 }],
    };
  }

  beforeEach(() => {
    store = new SessionStore();
    store.add(makeSession(viewerBufnr));
  });

  it("getRenderPlan returns undefined before any plan is set", () => {
    assertEquals(store.getRenderPlan(viewerBufnr), undefined);
  });

  it("setRenderPlan then getRenderPlan returns the plan", () => {
    const plan = makePlan();
    store.setRenderPlan(viewerBufnr, plan);
    assertEquals(store.getRenderPlan(viewerBufnr), plan);
  });

  it("setRenderPlan replaces the previous plan", () => {
    const p1 = makePlan();
    const p2: RenderPlan = { ...makePlan(), lines: ["updated"] };
    store.setRenderPlan(viewerBufnr, p1);
    store.setRenderPlan(viewerBufnr, p2);
    assertEquals(store.getRenderPlan(viewerBufnr)?.lines[0], "updated");
  });

  it("getRenderPlan returns undefined for unknown bufnr", () => {
    assertEquals(store.getRenderPlan(9999), undefined);
  });
});

// --- Phase 3.2: kernelRuntime augment (europa.session.state.kernel-runtime-*) ---

function makeKernelRuntime(): KernelRuntime {
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
  };
}

describe("SessionStore — kernelRuntime augment", () => {
  const bufnr = 30;

  beforeEach(() => {
    store = new SessionStore();
    store.add(makeSession(bufnr));
  });

  it("update with kernelRuntime sets it on the session", () => {
    const kr = makeKernelRuntime();
    store.update(bufnr, { kernelRuntime: kr });
    assertEquals(store.get(bufnr)?.kernelRuntime, kr);
  });

  it("get returns kernelRuntime after update", () => {
    const kr = makeKernelRuntime();
    store.update(bufnr, { kernelRuntime: kr });
    const runtime = store.get(bufnr);
    assertEquals(runtime?.kernelRuntime?.serverKey, "local:/usr/bin/jupyter");
    assertEquals(runtime?.kernelRuntime?.info.kernelName, "python3");
  });

  it("update with kernelRuntime: undefined removes it", () => {
    store.update(bufnr, { kernelRuntime: makeKernelRuntime() });
    store.update(bufnr, { kernelRuntime: undefined });
    assertEquals(store.get(bufnr)?.kernelRuntime, undefined);
  });

  it("idempotent: two updates preserve the last kernelRuntime", () => {
    const kr1 = makeKernelRuntime();
    const kr2 = { ...makeKernelRuntime(), serverKey: "local:/other/jupyter" };
    store.update(bufnr, { kernelRuntime: kr1 });
    store.update(bufnr, { kernelRuntime: kr2 });
    assertEquals(
      store.get(bufnr)?.kernelRuntime?.serverKey,
      "local:/other/jupyter",
    );
  });

  it("kernelRuntime does not interfere with cellEditBuffers map", () => {
    store.setCellEditBuffer(bufnr, "cell-x", 999);
    store.update(bufnr, { kernelRuntime: makeKernelRuntime() });
    assertEquals(store.getScratchBufnr(bufnr, "cell-x"), 999);
    assertEquals(
      store.get(bufnr)?.kernelRuntime?.info.kernelId,
      "kernel-test-id",
    );
  });
});

describe("SessionStore — byKernel", () => {
  beforeEach(() => {
    store = new SessionStore();
  });

  it("byKernel returns empty when no sessions have the kernel", () => {
    store.add(makeSession(40));
    assertEquals(store.byKernel("nonexistent-id").length, 0);
  });

  it("byKernel returns session with matching kernelId", () => {
    store.add(makeSession(41));
    const kr = makeKernelRuntime();
    store.update(41, { kernelRuntime: kr });
    const results = store.byKernel("kernel-test-id");
    assertEquals(results.length, 1);
    assertEquals(results[0].bufnr, 41);
  });

  it("byKernel returns 0 results after kernelRuntime is removed", () => {
    store.add(makeSession(42));
    store.update(42, { kernelRuntime: makeKernelRuntime() });
    store.update(42, { kernelRuntime: undefined });
    assertEquals(store.byKernel("kernel-test-id").length, 0);
  });

  it("byKernel scans all sessions (returns multiple if same kernelId shared)", () => {
    // Phase 3.2: 1 buffer = 1 kernel, but byKernel is many-to-many ready
    store.add(makeSession(43));
    store.add(makeSession(44));
    const kr43 = makeKernelRuntime();
    const kr44 = { ...makeKernelRuntime() }; // same kernelId
    store.update(43, { kernelRuntime: kr43 });
    store.update(44, { kernelRuntime: kr44 });
    const results = store.byKernel("kernel-test-id");
    assertEquals(results.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Phase 3.3: pendingRequests / execState / cellStates augment
// @spec-id europa.session.state.pending-requests-set
// @spec-id europa.session.state.pending-requests-remove
// @spec-id europa.session.state.exec-state-transition
// @spec-id europa.session.state.cell-states-update
// ---------------------------------------------------------------------------

describe("KernelRuntime — pendingRequests Map", () => {
  it("pendingRequests Map.set / Map.get roundtrip", () => {
    const kr = makeKernelRuntime();
    const entry = {
      msgId: "msg-1",
      bufnr: 1,
      cellId: "cell-a",
      state: "queued" as const,
      enqueuedAt: Date.now(),
      sentAt: null,
    };
    kr.pendingRequests.set("msg-1", entry);
    assertEquals(kr.pendingRequests.get("msg-1"), entry);
  });

  it("pendingRequests Map.delete removes the entry", () => {
    const kr = makeKernelRuntime();
    kr.pendingRequests.set("msg-2", {
      msgId: "msg-2",
      bufnr: 1,
      cellId: "cell-b",
      state: "queued",
      enqueuedAt: Date.now(),
      sentAt: null,
    });
    kr.pendingRequests.delete("msg-2");
    assertEquals(kr.pendingRequests.has("msg-2"), false);
  });

  it("remove KernelRuntime from session destroys all 3 fields", () => {
    store = new SessionStore();
    store.add(makeSession(50));
    const kr = makeKernelRuntime();
    kr.pendingRequests.set("msg-x", {
      msgId: "msg-x",
      bufnr: 50,
      cellId: "cell-x",
      state: "queued",
      enqueuedAt: Date.now(),
      sentAt: null,
    });
    kr.execState = "busy";
    kr.cellStates.set("cell-x", "busy");
    store.update(50, { kernelRuntime: kr });
    store.update(50, { kernelRuntime: undefined });
    assertEquals(store.get(50)?.kernelRuntime, undefined);
  });
});

describe("KernelRuntime — execState transitions", () => {
  it("initial execState is idle", () => {
    const kr = makeKernelRuntime();
    assertEquals(kr.execState, "idle");
  });

  it("execState can transition idle → busy → idle", () => {
    const kr = makeKernelRuntime();
    kr.execState = "busy";
    assertEquals(kr.execState, "busy");
    kr.execState = "idle";
    assertEquals(kr.execState, "idle");
  });

  it("execState can transition to restarting", () => {
    const kr = makeKernelRuntime();
    kr.execState = "restarting";
    assertEquals(kr.execState, "restarting");
  });

  it("execState can transition to disconnected", () => {
    const kr = makeKernelRuntime();
    kr.execState = "disconnected";
    assertEquals(kr.execState, "disconnected");
  });

  it("execState can transition to queued (runAll pre-enqueue phase)", () => {
    const kr = makeKernelRuntime();
    kr.execState = "queued";
    assertEquals(kr.execState, "queued");
  });
});

describe("KernelRuntime — cellStates Map", () => {
  it("cellStates per-cellId are independent", () => {
    const kr = makeKernelRuntime();
    kr.cellStates.set("cell-1", "queued");
    kr.cellStates.set("cell-2", "busy");
    assertEquals(kr.cellStates.get("cell-1"), "queued");
    assertEquals(kr.cellStates.get("cell-2"), "busy");
  });

  it("cellStates update for one cell does not affect others", () => {
    const kr = makeKernelRuntime();
    kr.cellStates.set("cell-a", "busy");
    kr.cellStates.set("cell-b", "idle");
    kr.cellStates.set("cell-a", "idle");
    assertEquals(kr.cellStates.get("cell-a"), "idle");
    assertEquals(kr.cellStates.get("cell-b"), "idle");
  });

  it("cellStates can be set to aborted", () => {
    const kr = makeKernelRuntime();
    kr.cellStates.set("cell-c", "aborted");
    assertEquals(kr.cellStates.get("cell-c"), "aborted");
  });
});
