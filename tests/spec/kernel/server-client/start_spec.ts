/**
 * BDD specs for ServerKernelClient.start() — normal attach, default subprotocol,
 * and error cases.
 *
 * Uses makeMockKernel() (in-process real HTTP+WS server) so these are
 * integration-level unit tests without needing a real Jupyter installation.
 *
 * @spec-id europa.kernel.server-client.start
 * @spec-id europa.kernel.server-client.connection-refused
 * @spec-id europa.kernel.server-client.token-missing-external
 * @spec-id europa.kernel.server-client.kernel-info-timeout
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
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

describe("ServerKernelClient.start — normal attach mode (v1 subprotocol)", () => {
  it("returns a KernelRuntime with non-null info on success", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
        jupyter_ws_subprotocol: "auto" as const,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      const runtime = await client.start({ kernelName: "python3" });
      assertEquals(typeof runtime.info.kernelId, "string");
      assertEquals(runtime.info.kernelName, "python3");
      assertEquals(typeof runtime.socket, "object");
      assertEquals(runtime.socket.readyState, WebSocket.OPEN);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("KernelRuntime has non-empty serverKey", async () => {
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
      const runtime = await client.start({ kernelName: "python3" });
      assertEquals(typeof runtime.serverKey, "string");
      assertEquals(runtime.serverKey.length > 0, true);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("KernelRuntime.abort is an AbortController", async () => {
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
      const runtime = await client.start({ kernelName: "python3" });
      assertInstanceOf(runtime.abort, AbortController);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("KernelRuntime.info.state is 'idle' after start", async () => {
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
      const runtime = await client.start({ kernelName: "python3" });
      assertEquals(runtime.info.state, "idle");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });
});

describe("ServerKernelClient.start — default subprotocol (text JSON)", () => {
  it("succeeds with default (text JSON) subprotocol", async () => {
    const mk = makeMockKernel({
      acceptSubprotocols: [], // only default
    });
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
        jupyter_ws_subprotocol: "default" as const,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      const runtime = await client.start({ kernelName: "python3" });
      assertEquals(runtime.info.subprotocol, "default");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });
});

describe("ServerKernelClient.start — error cases", () => {
  it("throws TOKEN_MISSING for attach mode without token", async () => {
    const pool = new ServerPool();
    const config = { ...BASE_CONFIG, jupyter_token: "" };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool);
    const err = await assertRejects(
      () => client.start({ kernelName: "python3" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "TOKEN_MISSING");
  });

  it("throws CONNECTION_REFUSED for unreachable server", async () => {
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_url: "http://127.0.0.1:1", // port 1 is unreachable
      jupyter_token: "sometoken",
    };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool);
    const err = await assertRejects(
      () => client.start({ kernelName: "python3" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "CONNECTION_REFUSED");
  });

  it("throws KERNEL_INFO_TIMEOUT when reply delayed beyond timeout", async () => {
    const mk = makeMockKernel({ replyDelayMs: 200 });
    try {
      const pool = new ServerPool();
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool, {
        kernelInfoTimeoutMs: 50, // 50ms timeout — reply comes after 200ms
      });
      const err = await assertRejects(
        () => client.start({ kernelName: "python3" }),
        EuropaKernelError,
      );
      assertEquals((err as EuropaKernelError).code, "KERNEL_INFO_TIMEOUT");
    } finally {
      await mk.close();
    }
  });
});
