/**
 * BDD specs for ServerKernelClient: subprocess spawn mode (US1 AC#1).
 *
 * Uses makeMockKernel() (in-process real HTTP+WS server) so these are
 * integration-level unit tests without needing a real Jupyter installation.
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ServerKernelClient } from "../../../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../../../denops/europa/kernel/server-pool.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import type { spawnJupyterServer } from "../../../../denops/europa/kernel/server-process.ts";
import { makeMockKernel } from "../../../fixtures/mock-kernel.ts";
import type { EuropaConfig } from "../../../../schema/config.ts";

const BASE_CONFIG: EuropaConfig = {
  connection_mode: "server",
  jupyter_url: "http://localhost:8888",
  jupyter_token: "",
  jupyter_ws_subprotocol: "auto",
  default_kernel: "python3",
  auto_start_kernel: false,
  jupyter_executable: "",
  python_env_detect: "auto",
  image_backend: "auto",
  mime_priority: ["image/png", "text/plain"],
  max_output_lines: 100,
  cell_border_chars: ["╭", "─", "╮", "╰", "╯"],
  cell_border_padding: 4,
  cell_border_align: "left" as const,
  lazy_padding: 10,
  auto_save: false,
  use_subprocess: false, // attach mode for unit tests
  wsReconnectMaxRetries: 5,
  wsReconnectInitialIntervalMs: 1000,
  wsReconnectMultiplier: 2.0,
  kernelInfoTimeoutMs: 10000,
  undo_max_history: 100,
  disable_default_mappings: false,
  ts_highlight: "auto",
};

function makeMockDenops(vars: Record<string, unknown> = {}) {
  return {
    eval: (expr: string): Promise<unknown> => {
      const match = expr.match(/^get\(g:, '([^']+)', '([^']*)'\)$/);
      if (match) return Promise.resolve(vars[match[1]] ?? match[2]);
      return Promise.resolve(null);
    },
  };
}

describe("ServerKernelClient.start — subprocess spawn mode (US1 AC#1)", () => {
  it("invokes spawnServer and uses its returned URL (not config.jupyter_url)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        // Confirm config.jupyter_url is NOT used in subprocess mode by setting
        // it to an unreachable port. If start() reaches this URL, the test fails.
        jupyter_url: "http://127.0.0.1:1",
        jupyter_token: mk.token,
        use_subprocess: true,
      };
      const denops = makeMockDenops({});

      let spawnCalls = 0;
      let receivedToken = "";
      const fakeSpawn: typeof spawnJupyterServer = (_exe, sopts) => {
        spawnCalls++;
        receivedToken = sopts.token;
        return Promise.resolve({
          pid: 99999,
          port: parseInt(new URL(mk.url).port, 10),
          token: sopts.token,
          url: mk.url,
          watchdogPid: undefined,
          kill: () => Promise.resolve(),
        });
      };

      const client = new ServerKernelClient(denops as never, config, pool, {
        detectExecutable: () => Promise.resolve(Deno.execPath()),
        spawnServer: fakeSpawn,
      });
      const runtime = await client.start({ kernelName: "python3" });

      assertEquals(spawnCalls, 1);
      assertEquals(receivedToken, mk.token);
      assertEquals(runtime.serverKey.startsWith("local:"), true);
      assertEquals(runtime.info.kernelName, "python3");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("generates a random token when none configured (Priority 4)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: "http://127.0.0.1:1",
        jupyter_token: "", // none → random hex via resolveToken Priority 4
        use_subprocess: true,
      };
      const denops = makeMockDenops({});

      let observedToken = "";
      const fakeSpawn: typeof spawnJupyterServer = (_exe, sopts) => {
        observedToken = sopts.token;
        // Mock kernel won't accept a random token, so we override its
        // accept by not actually spawning — just point at the mk URL but
        // pass back the token we received (the fetch will be 403, but
        // the spawn-wiring assertion runs before that).
        return Promise.resolve({
          pid: 1,
          port: parseInt(new URL(mk.url).port, 10),
          token: sopts.token,
          url: mk.url,
          watchdogPid: undefined,
          kill: () => Promise.resolve(),
        });
      };

      const client = new ServerKernelClient(denops as never, config, pool, {
        detectExecutable: () => Promise.resolve(Deno.execPath()),
        spawnServer: fakeSpawn,
      });
      // The downstream POST will fail (mock has its own token) — we only care
      // that resolveToken did NOT throw TOKEN_MISSING and a non-empty token
      // reached spawnServer.
      try {
        await client.start({ kernelName: "python3" });
      } catch { /* expected — auth mismatch with mock */ }
      await client.shutdown();

      assertEquals(observedToken.length, 32);
      assertEquals(/^[0-9a-f]{32}$/.test(observedToken), true);
    } finally {
      await mk.close();
    }
  });

  it("propagates JUPYTER_NOT_FOUND from detectExecutable", async () => {
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_token: "irrelevant",
      use_subprocess: true,
    };
    const denops = makeMockDenops({});

    const client = new ServerKernelClient(denops as never, config, pool, {
      detectExecutable: () =>
        Promise.reject(
          new EuropaKernelError("JUPYTER_NOT_FOUND", "no jupyter on PATH"),
        ),
      spawnServer: () => {
        throw new Error("spawnServer must not be called when detect fails");
      },
    });
    const err = await assertRejects(
      () => client.start({ kernelName: "python3" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "JUPYTER_NOT_FOUND");
  });
});
