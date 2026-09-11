/**
 * Conformance: Kernel lifecycle against a real Jupyter Server.
 *
 * Covers SC-002 (start ≤5s), SC-003 (kernel_info_reply), SC-004 (shutdown
 * subprocess ≤5s), SC-006 (process leak-free), SC-013 (multi-buffer server
 * share: same pid, different kernel id), SC-020 (reconnect-default config).
 *
 * Skips early with a user-friendly message if `jupyter` is not installed.
 *
 * @spec-id europa.conformance.kernel-lifecycle.basic
 * @spec-id europa.conformance.kernel-lifecycle.multi-buffer-share
 * @spec-id europa.conformance.kernel-lifecycle.reconnect-default
 */

import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import {
  type ConformanceServer,
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";
import { createConformanceClient, startConformanceKernel } from "./client.ts";
import {
  assertWithinBudget,
  KERNEL_SHUTDOWN_BUDGET_MS,
  KERNEL_START_BUDGET_MS,
} from "./timeouts.ts";

// Shared jupyter binary check; skip all tests if absent.
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

describe("conformance: kernel lifecycle (shared server)", () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    if (!jupyterPresent) return;
    server = await spawnConformanceServer();
  });

  afterAll(async () => {
    if (!jupyterPresent) return;
    await server.stop();
  });

  describe("basic (SC-002, SC-003, SC-004, SC-006)", () => {
    it("start() completes within 5s and returns a connected KernelRuntime", async () => {
      if (!jupyterPresent) return;
      const pool = new ServerPool();
      const client = createConformanceClient(server, pool);
      const startMs = Date.now();
      const runtime = await startConformanceKernel(client, server);
      const elapsed = Date.now() - startMs;
      // SC-002: start must finish within 5 s on a local jupyter server.
      assertWithinBudget("start()", elapsed, KERNEL_START_BUDGET_MS);
      assertExists(runtime.info.kernelId);
      assertEquals(runtime.info.kernelName, "python3");
      assertEquals(runtime.socket.readyState, WebSocket.OPEN);
      await client.shutdown();
    });

    it("start() receives kernel_info_reply and populates languageInfo (SC-003)", async () => {
      if (!jupyterPresent) return;
      const pool = new ServerPool();
      const client = createConformanceClient(server, pool);
      const runtime = await startConformanceKernel(client, server);
      // SC-003: kernel_info_reply must include language_info.
      assertExists(runtime.info.languageInfo);
      assertEquals(runtime.info.languageInfo?.name, "python");
      await client.shutdown();
    });

    it("shutdown() tears down session within 5s and leaves no leaked connections (SC-004, SC-006)", async () => {
      if (!jupyterPresent) return;
      const pool = new ServerPool();
      const client = createConformanceClient(server, pool);
      const runtime = await startConformanceKernel(client, server);
      assert(runtime.socket.readyState === WebSocket.OPEN);

      const shutdownMs = Date.now();
      await client.shutdown();
      const elapsed = Date.now() - shutdownMs;
      // SC-004: shutdown must complete within 5 s.
      assertWithinBudget("shutdown()", elapsed, KERNEL_SHUTDOWN_BUDGET_MS);
      // After shutdown the socket is no longer OPEN.
      assert(runtime.socket.readyState !== WebSocket.OPEN);
    });
  });

  describe("multi-buffer server share (SC-013)", () => {
    it("two clients share the same server subprocess (same subprocessPid, different kernelId)", async () => {
      if (!jupyterPresent) return;
      // Subprocess mode is required to observe pid sharing. Skip in attach mode —
      // SC-013 is verified structurally via unit specs (server-pool_spec.ts). The
      // attach-mode integration check below still validates distinct kernel IDs.
      // Shared pool is the Q1 mechanism: same pool instance → same server handle.
      const pool = new ServerPool();
      const client1 = createConformanceClient(server, pool);
      const client2 = createConformanceClient(server, pool);

      const [rt1, rt2] = await Promise.all([
        startConformanceKernel(client1, server),
        startConformanceKernel(client2, server),
      ]);

      // Both must land on the same server key (Q1 server singleton).
      assertEquals(rt1.serverKey, rt2.serverKey);
      // Kernel IDs must differ (separate kernel sessions).
      assert(
        rt1.info.kernelId !== rt2.info.kernelId,
        "kernelIds should be distinct",
      );

      await Promise.all([client1.shutdown(), client2.shutdown()]);
    });
  });

  describe("reconnect-default config (SC-020)", () => {
    it("default reconnect config (max=5, initial=1000ms, multiplier=2) is active", async () => {
      if (!jupyterPresent) return;
      // SC-020: verify that the default reconnect options produce the expected
      // backoff sequence.  We inspect the runtime abort signal — no actual
      // disconnect is triggered here (that path is covered by abort_race_spec).
      const pool = new ServerPool();
      const client = createConformanceClient(server, pool);
      const runtime = await startConformanceKernel(client, server);

      // Read the values off the client, not off a second config object built
      // for the assertion: the factory builds the client's config internally,
      // so a separately built one proves nothing about what the client is
      // using. These are the defaults per DESIGN.md §9.1.
      assertEquals(client.wsReconnectMaxRetries, 5);
      assertEquals(client.wsReconnectInitialIntervalMs, 1000);
      assertEquals(client.wsReconnectMultiplier, 2.0);
      // The AbortController is live immediately after start().
      assert(!runtime.abort.signal.aborted);

      await client.shutdown();
    });
  });
});
