/**
 * ServerPool: refcount-based registry for shared Jupyter Server instances.
 *
 * One subprocess (or remote URL) may serve many kernel sessions. The pool
 * tracks live handles by `serverKey` and implements single-flight deduplication
 * so concurrent `acquire` calls for the same key only spawn one subprocess.
 *
 * @module europa-kernel-server-pool
 * @category Kernel
 */

import type { ServerHandle } from "../../../schema/session.ts";

/**
 * Runtime handle: the TypeBox ServerHandle schema plus an optional `kill`
 * function. TypeBox cannot express functions, so this lives outside the schema.
 *
 * Invariant: `(handle.pid === undefined) === (handle.kill === undefined)`
 */
export type ActiveHandle = ServerHandle & {
  /** Tear down the subprocess (idempotent). Only set for local spawns. */
  kill?: () => Promise<void>;
};

/** Partial handle returned by a spawnFn (before pool assigns key/refcount). */
export type SpawnResult = Omit<ActiveHandle, "refcount" | "serverKey">;

/**
 * Acquire/release registry for shared Jupyter Server processes.
 *
 * Lifecycle invariants:
 *   - First acquire(key, spawnFn) spawns/attaches and registers refcount=1
 *   - Subsequent acquire(key) reuses, refcount += 1
 *   - release(key) decrements refcount; refcount==0 triggers kill() and removal
 *   - Concurrent acquire(key) for an in-flight spawn deduplicates via Promise
 *
 * @category Kernel
 */
export class ServerPool {
  private active = new Map<string, ActiveHandle>();
  private inflight = new Map<string, Promise<ActiveHandle>>();

  /**
   * Acquires a ServerHandle for the given key, spawning if absent.
   *
   * Three paths:
   *   1. Active hit: increment refcount, return existing handle
   *   2. Inflight hit: await pending spawn, increment refcount
   *   3. New spawn: call spawnFn, store result, set refcount=1
   *
   * @param key - Canonical server key (local:... or remote:...)
   * @param spawnFn - Called only on first acquire; must return a partial handle
   * @returns The shared ActiveHandle with refcount incremented
   * @spec-id europa.kernel.server-pool.acquire-new
   * @spec-id europa.kernel.server-pool.acquire-reuse
   */
  async acquire(
    key: string,
    spawnFn: () => Promise<SpawnResult>,
  ): Promise<ActiveHandle> {
    // Fast path: already active
    const existing = this.active.get(key);
    if (existing) {
      existing.refcount++;
      return existing;
    }

    // Mid path: another acquire is in-flight for this key
    const pending = this.inflight.get(key);
    if (pending) {
      const handle = await pending;
      handle.refcount++;
      return handle;
    }

    // Slow path: first acquire — spawn the server
    const promise = (async (): Promise<ActiveHandle> => {
      try {
        const partial = await spawnFn();
        const handle: ActiveHandle = {
          ...partial,
          serverKey: key,
          refcount: 1,
        };
        this.active.set(key, handle);
        this.inflight.delete(key);
        return handle;
      } catch (err) {
        // Clear inflight on spawn failure so retry is possible
        this.inflight.delete(key);
        throw err;
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Decrements refcount for the given key. Kills and removes when refcount == 0.
   *
   * Idempotent: no-op if key not found.
   *
   * @param key - Same canonical key passed to acquire
   * @spec-id europa.kernel.server-pool.release-decref
   * @spec-id europa.kernel.server-pool.release-kill
   */
  async release(key: string): Promise<void> {
    const handle = this.active.get(key);
    if (!handle) return; // Already removed or never registered

    handle.refcount--;
    if (handle.refcount <= 0) {
      this.active.delete(key);
      try {
        await handle.kill?.();
      } catch {
        // Swallow kill errors — subprocess may already be dead
      }
    }
  }

  /**
   * Returns a defensive snapshot of all currently active handles.
   *
   * @spec-id europa.kernel.server-pool.snapshot
   */
  snapshot(): ActiveHandle[] {
    return [...this.active.values()];
  }

  /**
   * Force-kills all active handles regardless of refcount.
   *
   * Only for VimLeavePre atexit cleanup — normal code must use release().
   *
   * @spec-id europa.kernel.server-pool.kill-all
   */
  async killAll(): Promise<void> {
    const handles = [...this.active.values()];
    this.active.clear();
    await Promise.all(
      handles.map(async (h) => {
        try {
          await h.kill?.();
        } catch {
          // ignore
        }
      }),
    );
  }
}

/**
 * Normalize a remote base URL to a canonical server key.
 *
 * Removes trailing slashes, query strings, and fragments, but preserves
 * pathname so JupyterHub `/user/alice/` and `/user/bob/` remain distinct.
 *
 * @param rawUrl - Raw Jupyter server URL
 * @returns Canonical key in the form `remote:<normalized_url>`
 * @spec-id europa.kernel.server-pool.key-strategy
 */
export function makeRemoteServerKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return `remote:${url.protocol}//${url.host.toLowerCase()}${url.pathname}`;
}

/**
 * Build a canonical `local:` server key for a subprocess-mode Jupyter server.
 *
 * Uses Deno.realPath to resolve symlinks, ensuring that `.venv/bin/jupyter`
 * and its canonical absolute path map to the same key (= 1 singleton per Vim).
 *
 * @param executablePath - Path to the jupyter executable
 * @returns Canonical key in the form `local:<realPath>`
 */
export async function makeLocalServerKey(
  executablePath: string,
): Promise<string> {
  const realPath = await Deno.realPath(executablePath);
  return `local:${realPath}`;
}
