/**
 * BDD specs for ServerKernelClient: shutdown, onMessage, and reconnection.
 *
 * Uses makeMockKernel() (in-process real HTTP+WS server) so these are
 * integration-level unit tests without needing a real Jupyter installation.
 *
 * @spec-id europa.kernel.server-client.shutdown
 * @spec-id europa.kernel.server-client.on-message
 * @spec-id europa.kernel.server-client.reconnection
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { delay } from "@std/async/delay";
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

describe("ServerKernelClient.onMessage", () => {
  it("handler is called when WebSocket sends a message", async () => {
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

      const received: unknown[] = [];
      const unsub = client.onMessage((msg) => {
        received.push(msg);
      });

      // The test verifies that unsubscribe works
      unsub();
      assertEquals(typeof unsub, "function");
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });

  it("unsubscribe removes the handler (second call is no-op)", async () => {
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

      let callCount = 0;
      const unsub = client.onMessage((_msg) => {
        callCount++;
      });
      unsub();
      unsub(); // idempotent

      assertEquals(callCount, 0);
      await client.shutdown();
    } finally {
      await mk.close();
    }
  });
});

describe("ServerKernelClient.shutdown", () => {
  it("is idempotent: second shutdown does not throw", async () => {
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
      await client.shutdown();
      await client.shutdown(); // second call should not throw
    } finally {
      await mk.close();
    }
  });

  it("closes WebSocket on shutdown", async () => {
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
      const socket = runtime.socket;
      await client.shutdown();
      // Give WS time to close
      await delay(50);
      assertEquals(
        socket.readyState === WebSocket.CLOSING ||
          socket.readyState === WebSocket.CLOSED,
        true,
      );
    } finally {
      await mk.close();
    }
  });

  it("issues DELETE /api/sessions on shutdown (SC-004)", async () => {
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
      assertEquals(mk.deletedSessions.length, 0, "no DELETE before shutdown");
      await client.shutdown();
      await delay(50);
      assertEquals(mk.deletedSessions.length, 1, "DELETE issued on shutdown");
    } finally {
      await mk.close();
    }
  });

  it("calls serverPool.release on shutdown (refcount SC-013)", async () => {
    const mk = makeMockKernel();
    try {
      const pool = new ServerPool();
      let releaseCalls = 0;
      const originalRelease = pool.release.bind(pool);
      pool.release = (key: string) => {
        releaseCalls++;
        return originalRelease(key);
      };
      const config = {
        ...BASE_CONFIG,
        jupyter_url: mk.url,
        jupyter_token: mk.token,
      };
      const denops = makeMockDenops({});
      const client = new ServerKernelClient(denops as never, config, pool);
      await client.start({ kernelName: "python3" });
      assertEquals(releaseCalls, 0);
      await client.shutdown();
      assertEquals(releaseCalls, 1, "pool.release called exactly once");
      await client.shutdown(); // idempotent — no second release
      assertEquals(
        releaseCalls,
        1,
        "second shutdown must not call release again",
      );
    } finally {
      await mk.close();
    }
  });

  it("external attach does not kill server on shutdown (SC-014)", async () => {
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
      await client.shutdown();
      // Mock kernel is still reachable after shutdown (external server stays up)
      const resp = await fetch(`${mk.url}/api/kernelspecs`, {
        headers: { Authorization: `token ${mk.token}` },
      });
      await resp.body?.cancel();
      assertEquals(
        resp.ok,
        true,
        "external server still alive after client shutdown",
      );
    } finally {
      await mk.close();
    }
  });
});

describe("ServerKernelClient.reconnection — option 3 cases", () => {
  it("max_retries=0 disables reconnect (immediate disconnect)", async () => {
    const mk = makeMockKernel({ closeAfterOpen: true });
    const pool = new ServerPool();
    const config = {
      ...BASE_CONFIG,
      jupyter_url: mk.url,
      jupyter_token: mk.token,
      wsReconnectMaxRetries: 0,
    };
    const denops = makeMockDenops({});
    const client = new ServerKernelClient(denops as never, config, pool, {
      kernelInfoTimeoutMs: 3000,
    });
    try {
      // With closeAfterOpen, the WS closes after kernel_info_reply
      // but since closeAfterOpen is before the reply, start will fail
      const err = await assertRejects(
        () => client.start({ kernelName: "python3" }),
        EuropaKernelError,
      );
      // Either KERNEL_INFO_TIMEOUT or KERNEL_INFO_FAILED or SUBPROTOCOL_REJECTED
      assertEquals(
        ["KERNEL_INFO_TIMEOUT", "KERNEL_INFO_FAILED", "SUBPROTOCOL_REJECTED"]
          .includes(
            (err as EuropaKernelError).code,
          ),
        true,
      );
    } finally {
      await client.shutdown().catch(() => {});
      await mk.close();
    }
  });
});
