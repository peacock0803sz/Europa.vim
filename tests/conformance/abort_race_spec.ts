/**
 * Conformance: AbortController abort-race scenarios against a real Jupyter Server.
 *
 * Covers SC-010a: three cases where AbortController.abort() is called during
 * an async operation. The first two time the abort itself and assert against
 * `ABORT_PROPAGATION_BUDGET_MS`; the third times a whole `start()` settling
 * after an abort and asserts against `START_ABORT_BUDGET_MS`, which is 50x
 * larger.
 *
 * - during-reconnect: abort fired while the reconnect backoff timer is active
 *   (ABORT_PROPAGATION_BUDGET_MS)
 * - during-kernel-info: abort fired before kernel_info_reply arrives, timeout
 *   path (ABORT_PROPAGATION_BUDGET_MS)
 * - during-open: abort fired immediately after start() is initiated
 *   (START_ABORT_BUDGET_MS)
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.conformance.abort-race.during-reconnect
 * @spec-id europa.conformance.abort-race.during-kernel-info
 * @spec-id europa.conformance.abort-race.during-open
 */

import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { delay } from "@std/async/delay";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import {
  clearAllSessions,
  type ConformanceServer,
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";
import { createConformanceClient, startConformanceKernel } from "./client.ts";
import {
  ABORT_POLL_LIMIT_MS,
  ABORT_PROPAGATION_BUDGET_MS,
  assertWithinBudget,
  EXACT_ABORT_POLL_INTERVAL_MS,
  EXACT_KERNEL_INFO_IMMEDIATE_MS,
  RECONNECT_BACKOFF_INITIAL_MS,
  RECONNECT_SETTLE_DELAY_MS,
  START_ABORT_BUDGET_MS,
} from "./timeouts.ts";

let jupyterPresent = true;
try {
  await ensureJupyter();
} catch (e) {
  if (e instanceof JupyterMissingError) {
    jupyterPresent = false;
    console.warn(String(e));
  } else {
    throw e;
  }
}

/** Long initial backoff so the abort clearly races a sleeping reconnect loop. */
const SLOW_RECONNECT = {
  wsReconnectInitialIntervalMs: RECONNECT_BACKOFF_INITIAL_MS,
} as const;

describe("conformance: abort race — during reconnect (SC-010a)", () => {
  it("abort() during reconnect backoff resolves within ABORT_PROPAGATION_BUDGET_MS", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer();
    let serverStopped = false;

    try {
      const pool = new ServerPool();
      const client = createConformanceClient(server, pool, {
        config: SLOW_RECONNECT,
      });

      const runtime = await startConformanceKernel(client, server);
      assert(runtime.socket.readyState === WebSocket.OPEN);

      // Force the server down to trigger the reconnect loop.
      await server.stop();
      serverStopped = true;

      // Wait briefly for the close event to fire and the reconnect loop to
      // begin its first backoff sleep.
      await delay(RECONNECT_SETTLE_DELAY_MS);

      // SC-010a: AbortController.abort() must propagate through the reconnect
      // backoff delay() within ABORT_PROPAGATION_BUDGET_MS. Measure abort
      // signal propagation only — not shutdown(), which also awaits
      // DELETE /api/sessions and is not bounded by this spec.
      const t0 = Date.now();
      runtime.abort.abort();
      while (
        runtime.info.state !== "disconnected" &&
        Date.now() - t0 < ABORT_POLL_LIMIT_MS
      ) {
        await delay(EXACT_ABORT_POLL_INTERVAL_MS);
      }
      const elapsed = Date.now() - t0;

      assertWithinBudget(
        "abort signal propagation",
        elapsed,
        ABORT_PROPAGATION_BUDGET_MS,
      );

      // Cleanup outside the timing window (shutdown may await slow DELETE fetch).
      await client.shutdown();
    } finally {
      if (!serverStopped) await server.stop();
    }
  });
});

describe("conformance: abort race — non-destructive cases (SC-010a, shared server)", () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    if (!jupyterPresent) return;
    server = await spawnConformanceServer();
  });

  afterAll(async () => {
    if (!jupyterPresent) return;
    await server.stop();
  });

  // Aborted start() can leave a Jupyter /api/sessions record orphaned (the
  // failure path in server-client.ts releases the local pool but does not
  // DELETE the session). Sweep between tests so each test sees a clean server.
  afterEach(async () => {
    if (!jupyterPresent) return;
    await clearAllSessions(server);
  });

  it("external abort signal cancels a slow start() before kernel_info_reply", async () => {
    if (!jupyterPresent) return;
    const pool = new ServerPool();
    // Use a 1ms kernel_info timeout so it always times out.
    // The real abort test: the caller's AbortController is used as the signal.
    const client = createConformanceClient(server, pool, {
      config: SLOW_RECONNECT,
      // Effectively times out immediately; never scaled, or this stops being
      // an abort-race test.
      kernelInfoTimeoutMs: EXACT_KERNEL_INFO_IMMEDIATE_MS,
    });

    const ac = new AbortController();
    const startPromise = client.start({
      kernelName: "python3",
      signal: ac.signal,
    });

    // Abort almost immediately — the kernel_info timeout (1ms) will race.
    const t0 = Date.now();
    ac.abort();
    let threw = false;
    try {
      await startPromise;
    } catch {
      threw = true;
    }
    const elapsed = Date.now() - t0;

    assert(threw, "start() should reject when aborted");
    // SC-010a: abort must resolve within ABORT_PROPAGATION_BUDGET_MS.
    assertWithinBudget(
      "abort during kernel_info",
      elapsed,
      ABORT_PROPAGATION_BUDGET_MS,
    );
  });

  it("abort() immediately after start() fires is handled without dangling Promise", async () => {
    if (!jupyterPresent) return;
    const pool = new ServerPool();
    const client = createConformanceClient(server, pool, {
      config: SLOW_RECONNECT,
    });

    const ac = new AbortController();
    // Fire start() and abort in the same microtask batch — races WebSocket open.
    const startPromise = client.start({
      kernelName: "python3",
      signal: ac.signal,
    });
    ac.abort();

    const t0 = Date.now();
    try {
      await startPromise;
      // If it succeeds (timing won), clean up properly.
      await client.shutdown();
    } catch {
      // Expected: aborted before or during connection.
    }
    const elapsed = Date.now() - t0;

    // In either outcome, there must be no dangling async work after this point.
    // Deno test sanitizer will catch any unresolved timers or promises.
    assertWithinBudget(
      "start+abort resolution",
      elapsed,
      START_ABORT_BUDGET_MS,
    );
  });
});
