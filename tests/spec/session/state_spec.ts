/**
 * BDD specs for SessionStore.
 *
 * @spec-id europa.session.state.store
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { SessionStore } from "../../../denops/europa/session/state.ts";
import type { Session } from "../../../schema/session.ts";

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

describe("SessionStore / @spec-id europa.session.state.store", () => {
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
