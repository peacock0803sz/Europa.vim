/**
 * BDD specs for SessionStore.
 *
 * @spec-id europa.session.state.store
 * @spec-id europa.session.state.cell-edit-buffers
 * @spec-id europa.session.state.render-plan-cache
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { SessionStore } from "../../../denops/europa/session/state.ts";
import type { Session } from "../../../schema/session.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

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
