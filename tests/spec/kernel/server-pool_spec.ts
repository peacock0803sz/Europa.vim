/**
 * BDD specs for ServerPool: acquire, release, snapshot, killAll, key-strategy.
 *
 * @spec-id europa.kernel.server-pool.acquire-new
 * @spec-id europa.kernel.server-pool.acquire-reuse
 * @spec-id europa.kernel.server-pool.release-decref
 * @spec-id europa.kernel.server-pool.release-kill
 * @spec-id europa.kernel.server-pool.key-strategy
 * @spec-id europa.kernel.server-pool.snapshot
 * @spec-id europa.kernel.server-pool.kill-all
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  makeRemoteServerKey,
  ServerPool,
} from "../../../denops/europa/kernel/server-pool.ts";

/** Factory for a minimal mock handle without kill */
function makeHandle(
  port = 8888,
): {
  pid: number;
  port: number;
  token: string;
  url: string;
  watchdogPid?: number;
} {
  return { pid: 9999, port, token: "tok", url: `http://127.0.0.1:${port}` };
}

/** Factory for a handle with a kill spy */
function makeHandleWithKill(): {
  handle: {
    pid: number;
    port: number;
    token: string;
    url: string;
    kill: () => Promise<void>;
  };
  killed: { count: number };
} {
  const killed = { count: 0 };
  return {
    handle: {
      pid: 9999,
      port: 8888,
      token: "tok",
      url: "http://127.0.0.1:8888",
      kill: async () => {
        killed.count++;
        await Promise.resolve();
      },
    },
    killed,
  };
}

describe("ServerPool.acquire — new key", () => {
  it("calls spawnFn once for a new key (spec-id acquire-new)", async () => {
    const pool = new ServerPool();
    let spawnCount = 0;
    const handle = await pool.acquire("key1", () => {
      spawnCount++;
      return Promise.resolve(makeHandle());
    });
    assertEquals(spawnCount, 1);
    assertEquals(handle.refcount, 1);
    assertEquals(handle.serverKey, "key1");
  });

  it("stores the handle in active map after acquire", async () => {
    const pool = new ServerPool();
    await pool.acquire("key2", () => Promise.resolve(makeHandle()));
    const snap = pool.snapshot();
    assertEquals(snap.length, 1);
    assertEquals(snap[0].serverKey, "key2");
  });
});

describe("ServerPool.acquire — reuse existing key", () => {
  it("does NOT call spawnFn on second acquire for same key (spec-id acquire-reuse)", async () => {
    const pool = new ServerPool();
    let spawnCount = 0;
    await pool.acquire("keyA", () => {
      spawnCount++;
      return Promise.resolve(makeHandle());
    });
    const h2 = await pool.acquire("keyA", () => {
      spawnCount++;
      return Promise.resolve(makeHandle());
    });
    assertEquals(spawnCount, 1);
    assertEquals(h2.refcount, 2);
  });

  it("increments refcount on reuse", async () => {
    const pool = new ServerPool();
    await pool.acquire("k", () => Promise.resolve(makeHandle()));
    const h = await pool.acquire("k", () => Promise.resolve(makeHandle()));
    assertEquals(h.refcount, 2);
  });
});

describe("ServerPool.acquire — concurrent single-flight deduplication", () => {
  it("concurrent acquires for same key only spawn once, both get refcount=2", async () => {
    const pool = new ServerPool();
    let spawnCount = 0;
    const [h1, h2] = await Promise.all([
      pool.acquire("race", () => {
        spawnCount++;
        return Promise.resolve(makeHandle());
      }),
      pool.acquire("race", () => {
        spawnCount++;
        return Promise.resolve(makeHandle());
      }),
    ]);
    assertEquals(spawnCount, 1);
    assertEquals(h1.serverKey, "race");
    assertEquals(h2.serverKey, "race");
    // Both should point to the same object (refcount reflects both acquires)
    assertEquals(h1.refcount, 2);
    assertEquals(h2.refcount, 2);
  });
});

describe("ServerPool.release — refcount decrement", () => {
  it("release decrements refcount (spec-id release-decref)", async () => {
    const pool = new ServerPool();
    await pool.acquire("dec", () => Promise.resolve(makeHandle()));
    await pool.acquire("dec", () => Promise.resolve(makeHandle()));
    await pool.release("dec");
    const snap = pool.snapshot();
    assertEquals(snap[0].refcount, 1);
  });

  it("kill NOT called when refcount > 0 after release", async () => {
    const pool = new ServerPool();
    const { handle, killed } = makeHandleWithKill();
    await pool.acquire("nodelete", () => Promise.resolve({ ...handle }));
    await pool.acquire("nodelete", () => Promise.resolve({ ...handle }));
    await pool.release("nodelete");
    assertEquals(killed.count, 0);
  });
});

describe("ServerPool.release — kill at refcount==0", () => {
  it("kill IS called when refcount reaches 0 (spec-id release-kill)", async () => {
    const pool = new ServerPool();
    const { handle, killed } = makeHandleWithKill();
    const h = await pool.acquire("kill-test", () => Promise.resolve(handle));
    await pool.release("kill-test");
    assertEquals(killed.count, 1);
    void h;
  });

  it("active map no longer contains key after refcount==0 release", async () => {
    const pool = new ServerPool();
    let killCalled = false;
    await pool.acquire("removekey", () =>
      Promise.resolve({
        pid: 1,
        port: 1234,
        token: "t",
        url: "http://x",
        kill: () => {
          killCalled = true;
          return Promise.resolve();
        },
      }));
    await pool.release("removekey");
    const snap = pool.snapshot();
    assertEquals(snap.length, 0);
    void killCalled;
  });
});

describe("ServerPool.release — no-op for unknown key", () => {
  it("release on unknown key does not throw", async () => {
    const pool = new ServerPool();
    await pool.release("nonexistent"); // should not throw
  });
});

describe("ServerPool.snapshot — defensive copy", () => {
  it("snapshot returns a copy, not a live reference", async () => {
    const pool = new ServerPool();
    await pool.acquire("snap1", () => Promise.resolve(makeHandle(8888)));
    const snap = pool.snapshot();
    // Mutating the snapshot should not affect the pool
    snap.pop();
    const snap2 = pool.snapshot();
    assertEquals(snap2.length, 1);
  });

  it("snapshot reflects all active handles", async () => {
    const pool = new ServerPool();
    await pool.acquire("s1", () => Promise.resolve(makeHandle(1111)));
    await pool.acquire("s2", () => Promise.resolve(makeHandle(2222)));
    const snap = pool.snapshot();
    assertEquals(snap.length, 2);
    const keys = snap.map((h) => h.serverKey).sort();
    assertEquals(keys, ["s1", "s2"]);
  });
});

describe("ServerPool.killAll — force kill regardless of refcount", () => {
  it("killAll removes all entries (spec-id kill-all)", async () => {
    const pool = new ServerPool();
    await pool.acquire("a", () => Promise.resolve(makeHandle(1)));
    await pool.acquire("b", () => Promise.resolve(makeHandle(2)));
    await pool.killAll();
    assertEquals(pool.snapshot().length, 0);
  });

  it("killAll calls kill on handles that have it", async () => {
    const pool = new ServerPool();
    let killCount = 0;
    await pool.acquire("killable", () =>
      Promise.resolve({
        pid: 1,
        port: 1,
        token: "t",
        url: "http://x",
        kill: () => {
          killCount++;
          return Promise.resolve();
        },
      }));
    await pool.acquire("killable", () => Promise.resolve(makeHandle())); // refcount=2
    await pool.killAll();
    assertEquals(killCount, 1);
  });
});

describe("makeRemoteServerKey — URL normalization", () => {
  it("removes trailing slash from pathname", () => {
    const key = makeRemoteServerKey("http://example.com/user/foo/");
    assertEquals(key, "remote:http://example.com/user/foo");
  });

  it("removes query string", () => {
    const key = makeRemoteServerKey("http://example.com/?token=abc");
    assertEquals(key, "remote:http://example.com/");
  });

  it("removes fragment", () => {
    const key = makeRemoteServerKey("http://example.com/base#x");
    assertEquals(key, "remote:http://example.com/base");
  });

  it("different JupyterHub users get different keys", () => {
    const k1 = makeRemoteServerKey("https://hub.example.com/user/alice/");
    const k2 = makeRemoteServerKey("https://hub.example.com/user/bob/");
    assertEquals(k1 !== k2, true);
  });

  it("same URL with different query params collapse to same key", () => {
    const k1 = makeRemoteServerKey("http://localhost:8888/?token=abc");
    const k2 = makeRemoteServerKey("http://localhost:8888/?token=xyz");
    assertEquals(k1, k2);
  });
});
