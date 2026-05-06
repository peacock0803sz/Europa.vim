/**
 * BDD specs for the restart() kernel function.
 *
 * @spec-id europa.kernel.restart.rest-200
 * @spec-id europa.kernel.restart.websocket-reopen
 * @spec-id europa.kernel.restart.kernel-info-resync
 * @spec-id europa.kernel.restart.5xx-fallback
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { restart } from "../../../denops/europa/kernel/restart.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";
import type {
  KernelClient,
  KernelRuntime,
} from "../../../contracts/kernel-client.ts";
import type { KernelInfoReply } from "../../../schema/message.ts";

const MOCK_REPLY: KernelInfoReply = {
  status: "ok",
  protocol_version: "5.3",
  implementation: "ipython",
  implementation_version: "8.0",
  language_info: {
    name: "python",
    version: "3.12.0",
    mimetype: "text/x-python",
    file_extension: ".py",
  },
  banner: "IPython mock",
};

/** Null socket stub — readyState reflects the provided value */
function makeNullSocket(readyState: number = WebSocket.OPEN): WebSocket {
  const closed = { value: false };
  return {
    readyState,
    close(code?: number) {
      if (code === 1000) closed.value = true;
    },
    get _closed() {
      return closed.value;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
    binaryType: "arraybuffer",
  } as unknown as WebSocket & { _closed: boolean };
}

function makeClient(
  kernelInfoFn?: () => Promise<KernelInfoReply>,
): KernelClient {
  return {
    start: () => Promise.reject(new Error("not in test")),
    shutdown: () => Promise.reject(new Error("not in test")),
    onMessage: () => () => {},
    execute: () => {
      throw new Error("not in test");
    },
    kernelInfo: kernelInfoFn ?? (() => Promise.resolve(MOCK_REPLY)),
    interrupt: () => Promise.reject(new Error("not in test")),
    restart: () => Promise.reject(new Error("not in test")),
  };
}

function makeRuntime(
  kernelId: string,
  oldSocket: WebSocket,
  client?: KernelClient,
): KernelRuntime {
  return {
    info: {
      kernelId,
      sessionId: "sess-1",
      kernelName: "python3",
      connectionMode: "server",
      state: "idle",
      subprotocol: "default",
      startedAt: new Date().toISOString(),
      languageInfo: {
        name: "python",
        version: "3.11.0",
        mimetype: "text/x-python",
        file_extension: ".py",
      },
      banner: "old banner",
    },
    abort: new AbortController(),
    socket: oldSocket,
    serverKey: "remote:http://localhost/",
    client: client ?? makeClient(),
    pendingRequests: new Map(),
    execState: "idle",
    cellStates: new Map(),
  };
}

describe(
  "restart() REST layer",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const KERNEL_ID = "test-kernel-restart";
    const TOKEN = "restart-token-xyz";
    let server: Deno.HttpServer | null = null;
    let restartStatus = 200;
    let restartCallCount = 0;

    beforeEach(() => {
      restartStatus = 200;
      restartCallCount = 0;
      server = Deno.serve(
        { port: 0, hostname: "127.0.0.1", onListen: () => {} },
        (req) => {
          const url = new URL(req.url);
          if (req.method === "POST" && url.pathname.endsWith("/restart")) {
            restartCallCount++;
            if (restartStatus !== 200) {
              return new Response("Internal Server Error", {
                status: restartStatus,
              });
            }
            const kernelJson = {
              id: KERNEL_ID,
              name: "python3",
              last_activity: new Date().toISOString(),
              execution_state: "idle",
              connections: 0,
            };
            return Response.json(kernelJson, { status: 200 });
          }
          // WebSocket upgrade for new channel connection
          if (
            req.headers.has("upgrade") &&
            req.headers.get("upgrade")?.toLowerCase() === "websocket"
          ) {
            const { socket, response } = Deno.upgradeWebSocket(req);
            socket.onopen = () => {};
            return response;
          }
          return new Response("Not Found", { status: 404 });
        },
      );
    });

    afterEach(async () => {
      await server?.shutdown();
      server = null;
    });

    it(
      "(a) POST /restart → 200, old WS closed, new WS open, kernelInfo called, info updated",
      async () => {
        const port = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const wsUrl =
          `ws://127.0.0.1:${port}/api/kernels/${KERNEL_ID}/channels`;

        const oldSocket = makeNullSocket(WebSocket.OPEN) as WebSocket & {
          _closed: boolean;
        };
        let kernelInfoCalled = false;
        const client = makeClient(() => {
          kernelInfoCalled = true;
          return Promise.resolve(MOCK_REPLY);
        });
        const runtime = makeRuntime(KERNEL_ID, oldSocket, client);

        let reopenSocket: WebSocket | null = null;
        const onSocketReopen = (s: WebSocket) => {
          reopenSocket = s;
        };

        await restart(runtime, baseUrl, TOKEN, wsUrl, [], onSocketReopen);

        assertEquals(restartCallCount, 1, "exactly 1 REST restart call");
        assertEquals(
          (oldSocket as WebSocket & { _closed: boolean })._closed,
          true,
          "old WS should be closed with code 1000",
        );
        assertNotEquals(
          reopenSocket,
          null,
          "onSocketReopen should have been called",
        );
        assertEquals(
          kernelInfoCalled,
          true,
          "kernelInfo should have been called",
        );
        // runtime.info updated with new reply
        assertEquals(runtime.info.languageInfo?.version, "3.12.0");
        assertEquals(runtime.info.banner, "IPython mock");
        assertEquals(runtime.execState, "idle");
      },
    );

    it(
      "(a-order) onSocketReopen is called BEFORE kernelInfo",
      async () => {
        const port = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const wsUrl =
          `ws://127.0.0.1:${port}/api/kernels/${KERNEL_ID}/channels`;

        const callOrder: string[] = [];
        const client = makeClient(() => {
          callOrder.push("kernelInfo");
          return Promise.resolve(MOCK_REPLY);
        });
        const runtime = makeRuntime(KERNEL_ID, makeNullSocket(), client);
        const onSocketReopen = (_s: WebSocket) => {
          callOrder.push("onSocketReopen");
        };

        await restart(runtime, baseUrl, TOKEN, wsUrl, [], onSocketReopen);

        assertEquals(callOrder, ["onSocketReopen", "kernelInfo"]);
      },
    );

    it(
      "(b) 5xx response → RESTART_REST_FAILED, old WS preserved",
      async () => {
        restartStatus = 500;
        const port = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const wsUrl =
          `ws://127.0.0.1:${port}/api/kernels/${KERNEL_ID}/channels`;

        const oldSocket = makeNullSocket(WebSocket.OPEN) as WebSocket & {
          _closed: boolean;
        };
        const runtime = makeRuntime(KERNEL_ID, oldSocket);

        const err = await assertRejects(
          () => restart(runtime, baseUrl, TOKEN, wsUrl, [], () => {}),
        );
        assertInstanceOf(err, EuropaKernelError);
        assertEquals(err.code, "RESTART_REST_FAILED");
        // Old WS must NOT be closed on 5xx (FR-013)
        assertEquals(
          (oldSocket as WebSocket & { _closed: boolean })._closed,
          false,
          "old WS should NOT be closed on 5xx",
        );
        assertEquals(runtime.execState, "idle");
      },
    );

    it(
      "(c) kernelInfo timeout → RESTART_HANDSHAKE_FAILED",
      async () => {
        const port = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const wsUrl =
          `ws://127.0.0.1:${port}/api/kernels/${KERNEL_ID}/channels`;

        const client = makeClient(() =>
          Promise.reject(
            new EuropaKernelError(
              "KERNEL_INFO_TIMEOUT",
              "kernelInfo timed out",
            ),
          )
        );
        const runtime = makeRuntime(KERNEL_ID, makeNullSocket(), client);

        const err = await assertRejects(
          () => restart(runtime, baseUrl, TOKEN, wsUrl, [], () => {}),
        );
        assertInstanceOf(err, EuropaKernelError);
        assertEquals(err.code, "RESTART_HANDSHAKE_FAILED");
        assertEquals(runtime.execState, "idle");
      },
    );

    it(
      "(d) restart-during-busy: pendingRequests cleared, cellStates aborted",
      async () => {
        const port = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const wsUrl =
          `ws://127.0.0.1:${port}/api/kernels/${KERNEL_ID}/channels`;

        const runtime = makeRuntime(KERNEL_ID, makeNullSocket());
        // Simulate busy state with a pending request
        runtime.pendingRequests.set("msg-1", {
          msgId: "msg-1",
          bufnr: 1,
          cellId: "cell-1",
          state: "sent",
          enqueuedAt: Date.now(),
          sentAt: Date.now(),
        });
        runtime.cellStates.set("cell-1", "busy");
        runtime.execState = "busy";

        await restart(runtime, baseUrl, TOKEN, wsUrl, [], () => {});

        assertEquals(
          runtime.pendingRequests.size,
          0,
          "pendingRequests must be cleared by abortAll",
        );
        // cellStates are cleared in step (g)
        assertEquals(
          runtime.cellStates.size,
          0,
          "cellStates cleared after restart",
        );
        assertEquals(runtime.execState, "idle");
      },
    );

    it(
      "(a-auth) Authorization header carries token",
      async () => {
        let capturedAuth: string | null = null;
        await server!.shutdown();

        server = Deno.serve(
          { port: 0, hostname: "127.0.0.1", onListen: () => {} },
          (req) => {
            const url = new URL(req.url);
            if (req.method === "POST" && url.pathname.endsWith("/restart")) {
              capturedAuth = req.headers.get("Authorization");
              const kernelJson = {
                id: KERNEL_ID,
                name: "python3",
                last_activity: new Date().toISOString(),
                execution_state: "idle",
                connections: 0,
              };
              return Response.json(kernelJson, { status: 200 });
            }
            if (req.headers.has("upgrade")) {
              const { socket, response } = Deno.upgradeWebSocket(req);
              socket.onopen = () => {};
              return response;
            }
            return new Response("Not Found", { status: 404 });
          },
        );

        const newPort = (server!.addr as Deno.NetAddr).port;
        const baseUrl = `http://127.0.0.1:${newPort}`;
        const wsUrl =
          `ws://127.0.0.1:${newPort}/api/kernels/${KERNEL_ID}/channels`;
        const runtime = makeRuntime(KERNEL_ID, makeNullSocket());

        await restart(runtime, baseUrl, TOKEN, wsUrl, [], () => {});

        assertEquals(capturedAuth, `token ${TOKEN}`);
      },
    );
  },
);
