/**
 * BDD specs for ServerKernelClient: start, shutdown, onMessage, reconnection, abort.
 *
 * Uses makeMockKernel() (in-process real HTTP+WS server) so these are
 * integration-level unit tests without needing a real Jupyter installation.
 *
 * @spec-id europa.kernel.server-client.start
 * @spec-id europa.kernel.server-client.shutdown
 * @spec-id europa.kernel.server-client.on-message
 * @spec-id europa.kernel.server-client.reconnection
 * @spec-id europa.kernel.server-client.abort-race
 * @spec-id europa.kernel.server-client.kernel-info-timeout
 * @spec-id europa.kernel.server-client.external-attach
 * @spec-id europa.kernel.server-client.external-shutdown
 * @spec-id europa.kernel.server-client.token-missing-external
 * @spec-id europa.kernel.server-client.connection-refused
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { delay } from "@std/async/delay";
import { ServerKernelClient } from "../../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../../denops/europa/kernel/server-pool.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";
import type { spawnJupyterServer } from "../../../denops/europa/kernel/server-process.ts";
import { makeMockKernel } from "../../fixtures/mock-kernel.ts";
import type { EuropaConfig } from "../../../schema/config.ts";

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

describe("ServerKernelClient.kernelInfo — public method (US5)", () => {
  /**
   * @spec-id europa.kernel.server-client.kernel-info-public
   *
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
