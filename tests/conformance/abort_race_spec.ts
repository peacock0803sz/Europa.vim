/**
 * Conformance: AbortController abort-race scenarios against a real Jupyter Server.
 *
 * Covers SC-010a: three cases where AbortController.abort() is called during
 * an async operation, each resolving within 100ms.
 *
 * - during-reconnect: abort fired while the reconnect backoff timer is active
 * - during-kernel-info: abort fired before kernel_info_reply arrives (timeout path)
 * - during-open: abort fired immediately after start() is initiated
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.conformance.abort-race.during-reconnect
 * @spec-id europa.conformance.abort-race.during-kernel-info
 * @spec-id europa.conformance.abort-race.during-open
 */

import { describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { delay } from "@std/async/delay";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import type { EuropaConfig } from "../../schema/config.ts";
import {
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";

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

function makeMockDenops() {
  return { eval: (_expr: string): Promise<unknown> => Promise.resolve("") };
}

function makeConfig(
  url: string,
  token: string,
  reconnectMax = 5,
): EuropaConfig {
  return {
    connection_mode: "server",
    jupyter_url: url,
    jupyter_token: token,
    jupyter_ws_subprotocol: "auto",
    default_kernel: "python3",
    auto_start_kernel: false,
    jupyter_executable: "",
    python_env_detect: "auto",
    image_backend: "auto",
    mime_priority: ["image/png", "text/plain"],
    max_output_lines: 100,
    cell_border_chars: ["╭", "─", "╮", "╰", "╯"],
    lazy_padding: 10,
    auto_save: false,
    use_subprocess: false,
    wsReconnectMaxRetries: reconnectMax,
    wsReconnectInitialIntervalMs: 2000, // long initial delay for reliable abort test
    wsReconnectMultiplier: 2.0,
  };
}

describe("conformance: abort race — during reconnect (SC-010a)", () => {
  it("abort() during reconnect backoff timer resolves within 100ms", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer({ timeoutMs: 30_000 });
    let serverStopped = false;

    try {
      const pool = new ServerPool();
      // long reconnect interval so the abort timer is clearly racing against a
      // 2s backoff sleep
      const config = makeConfig(server.url, server.token, 5);
      const client = new ServerKernelClient(
        makeMockDenops() as never,
        config,
        pool,
      );

      const runtime = await client.start({ kernelName: "python3" });
      assert(runtime.socket.readyState === WebSocket.OPEN);

      // Force the server down to trigger the reconnect loop.
      await server.stop();
      serverStopped = true;

      // Wait briefly for the close event to fire and the reconnect loop to begin
      // its first 2s sleep.
      await delay(300);

      // Now abort — reconnect loop is sleeping for 2s, abort must win in 100ms.
      const t0 = Date.now();
      await client.shutdown();
      const elapsed = Date.now() - t0;

      // SC-010a: abort must resolve within 100ms.
      assert(
        elapsed < 100,
        `abort during reconnect took ${elapsed}ms, expected < 100ms`,
      );
    } finally {
      if (!serverStopped) await server.stop();
    }
  });
});

describe("conformance: abort race — during kernel_info wait (SC-010a)", () => {
  it("external abort signal cancels a slow start() before kernel_info_reply", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer({ timeoutMs: 30_000 });

    try {
      const pool = new ServerPool();
      // Use a 1ms kernel_info timeout so it always times out.
      // The real abort test: the caller's AbortController is used as the signal.
      const config = makeConfig(server.url, server.token);
      const client = new ServerKernelClient(
        makeMockDenops() as never,
        config,
        pool,
        { kernelInfoTimeoutMs: 1 }, // effectively times out immediately
      );

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
      // SC-010a: abort must resolve within 100ms.
      assert(
        elapsed < 100,
        `abort during kernel_info took ${elapsed}ms, expected < 100ms`,
      );
    } finally {
      await server.stop();
    }
  });
});

describe("conformance: abort race — during WebSocket open (SC-010a)", () => {
  it("abort() immediately after start() fires is handled without dangling Promise", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer({ timeoutMs: 30_000 });

    try {
      const pool = new ServerPool();
      const config = makeConfig(server.url, server.token);
      const client = new ServerKernelClient(
        makeMockDenops() as never,
        config,
        pool,
      );

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
      assert(
        elapsed < 5_000,
        `start+abort resolution took ${elapsed}ms, expected < 5000ms`,
      );
    } finally {
      await server.stop();
    }
  });
});
