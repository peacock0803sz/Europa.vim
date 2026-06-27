/**
 * BDD specs for the CommRegistry (Phase 5.1).
 *
 * @spec-id europa.kernel.comm.registry-insert
 * @spec-id europa.kernel.comm.registry-remove
 * @spec-id europa.kernel.comm.registry-list
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import { createCommRegistry } from "../../../../denops/europa/kernel/comm/registry.ts";
import type {
  CommEntry,
  CommHandle,
} from "../../../../contracts/comm-service.ts";

function stubHandle(commId: string): CommHandle {
  return {
    commId,
    targetName: "europa.test.echo",
    isOpen: () => true,
    send: () => Promise.resolve(),
    close: () => Promise.resolve(),
    onMessage: () => () => {},
    onClose: () => () => {},
    _fireOnMessage: () => {},
    _fireOnClose: () => {},
  };
}

function entryAt(commId: string, openedAt: number): CommEntry {
  return {
    commId,
    targetName: "europa.test.echo",
    opener: "frontend",
    openedAt,
    lastActivityAt: openedAt,
    handle: stubHandle(commId),
  };
}

describe("CommRegistry — insert/get/remove", () => {
  it("inserts and retrieves an entry by comm_id", () => {
    const r = createCommRegistry();
    const e = entryAt("c-1", 100);
    r.insert(e);
    assertEquals(r.get("c-1")?.commId, "c-1");
    assertEquals(r.size(), 1);
  });

  it("rejects duplicate inserts so dispatch.ts can reject the second comm_open", () => {
    const r = createCommRegistry();
    r.insert(entryAt("c-1", 1));
    assertThrows(() => r.insert(entryAt("c-1", 2)));
  });

  it("remove is idempotent for unknown commIds", () => {
    const r = createCommRegistry();
    r.remove("never-existed");
    assertEquals(r.size(), 0);
  });
});

describe("CommRegistry — list ordering", () => {
  it("list returns entries sorted by openedAt ascending", () => {
    const r = createCommRegistry();
    r.insert(entryAt("c-late", 200));
    r.insert(entryAt("c-early", 100));
    r.insert(entryAt("c-mid", 150));
    const ids = r.list().map((e) => e.commId);
    assertEquals(ids, ["c-early", "c-mid", "c-late"]);
  });

  it("list snapshot is independent of the registry (mutating the array does not affect future lists)", () => {
    const r = createCommRegistry();
    r.insert(entryAt("c-1", 100));
    const a = r.list();
    (a as CommEntry[]).pop();
    assertEquals(r.list().length, 1);
  });

  it("clear empties the registry", () => {
    const r = createCommRegistry();
    r.insert(entryAt("c-1", 1));
    r.insert(entryAt("c-2", 2));
    r.clear();
    assertEquals(r.size(), 0);
    assertEquals(r.list().length, 0);
  });
});
