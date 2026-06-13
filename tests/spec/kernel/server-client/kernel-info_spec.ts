/**
 * BDD specs for ServerKernelClient: kernelInfo() public method,
 * abort race, and external-attach mode.
 *
 * Uses makeMockKernel() (in-process real HTTP+WS server) so these are
 * integration-level unit tests without needing a real Jupyter installation.
 *
 * @spec-id europa.kernel.server-client.kernel-info-public
 * @spec-id europa.kernel.server-client.abort-race
 * @spec-id europa.kernel.server-client.external-attach
 * @spec-id europa.kernel.server-client.external-shutdown
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ServerKernelClient } from "../../../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../../../denops/europa/kernel/server-pool.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
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
  lsp_enable: "auto",
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

describe("ServerKernelClient.kernelInfo — public method (US5)", () => {
  /**
   * Verifies that kernelInfo() is a callable public method that sends a
   * kernel_info_request on the open WebSocket channel and returns the
   * KernelInfoReply within the configured timeout. R04: single-shot.
   */

  it("(a) kernelInfo() resolves with KernelInfoReply after start", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      await client.start({ kernelName: "python3" });
      const reply = await client.kernelInfo();
      assertEquals(reply.status, "ok");
      assertEquals(reply.language_info.name, "python");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("(b) kernelInfo() rejects with KERNEL_INFO_TIMEOUT when kernel is silent", async () => {
    // Mock responds only once (during start); subsequent kernelInfo() calls time out.
    const mk = makeMockKernel({ kernelInfoReplyLimit: 1 });
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool, {
        kernelInfoTimeoutMs: 200,
      });
      await client.start({ kernelName: "python3" }); // gets the one allowed reply
      const err = await assertRejects(
        () => client.kernelInfo(), // no reply → KERNEL_INFO_TIMEOUT
        EuropaKernelError,
      );
      assertEquals((err as EuropaKernelError).code, "KERNEL_INFO_TIMEOUT");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("(c) start() and kernelInfo() both send kernel_info_request (DRY path)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      await client.start({ kernelName: "python3" });
      await client.kernelInfo(); // explicit public call
      const kiRequests = mk.allWireMessages.filter(
        (m) => m.header.msg_type === "kernel_info_request",
      );
      assertEquals(
        kiRequests.length >= 2,
        true,
        `Expected >= 2 kernel_info_request messages, got ${kiRequests.length}`,
      );
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });
});

describe("ServerKernelClient.start — abort race (SC-010a)", () => {
  it("external signal abort propagates before start completes", async () => {
    const mk = makeMockKernel({ replyDelayMs: 5000 }); // very slow reply
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_url: mk.url,
      jupyter_token: mk.token,
    };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool);
    try {
      const ac = new AbortController();
      const startPromise = client.start({
        kernelName: "python3",
        signal: ac.signal,
      });

      // Abort after 30ms — start is waiting for slow reply
      setTimeout(() => ac.abort(), 30);

      const start = Date.now();
      try {
        await startPromise;
        throw new Error("Expected abort");
      } catch (_e) {
        const elapsed = Date.now() - start;
        // Should abort within 100ms of the abort() call (SC-010a)
        assertEquals(elapsed < 200, true, `abort took ${elapsed}ms`);
      }
    } finally {
      // Safety net: even if start() rejected and reset internal state,
      // a stray socket from a future regression would be caught here
      // before mk.close() ends the test scope.
      await client.shutdown().catch(() => {});
      await mk.close();
    }
  });
});

describe("ServerKernelClient.start — external attach (US5 SC-014)", () => {
  it("attach mode does not kill server on shutdown (no subprocess)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
        use_subprocess: false,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      const runtime = await client.start({ kernelName: "python3" });
      // serverKey should be a remote: key
      assertEquals(runtime.serverKey.startsWith("remote:"), true);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("pool handle has no kill function (no subprocess spawned)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
        use_subprocess: false,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      await client.start({ kernelName: "python3" });
      // Invariant: external attach handle has no kill (no subprocess was spawned)
      const handles = pool.snapshot();
      assertEquals(handles.length, 1);
      assertEquals(handles[0].kill, undefined);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("TOKEN_MISSING when no token is set for external attach", async () => {
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_token: "",
      use_subprocess: false,
    };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool);
    const err = await assertRejects(
      () => client.start({ kernelName: "python3" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "TOKEN_MISSING");
  });

  it("CONNECTION_REFUSED for unreachable external server", async () => {
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_url: "http://127.0.0.1:1",
      jupyter_token: "sometoken",
      use_subprocess: false,
    };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool);
    const err = await assertRejects(
      () => client.start({ kernelName: "python3" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "CONNECTION_REFUSED");
  });
});
