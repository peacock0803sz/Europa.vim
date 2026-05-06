/**
 * HTTP+WebSocket kernel client for Jupyter Server (attach mode).
 *
 * Implements KernelClient using the Jupyter Server REST API and WebSocket
 * channels endpoint. Supports both the v1 binary subprotocol and the default
 * text-JSON subprotocol, plus external-signal abort and configurable
 * kernel_info_reply timeout.
 *
 * @module europa-kernel-server-client
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import type {
  KernelClient,
  KernelRuntime,
} from "../../../contracts/kernel-client.ts";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { KernelInfo, KernelState } from "../../../schema/session.ts";
import type { KernelMessage } from "../../../schema/message.ts";
import { delay } from "@std/async/delay";
import { buildAuthHeader, buildSubprotocols, resolveToken } from "./auth.ts";
import { EuropaKernelError } from "./errors.ts";
import {
  makeLocalServerKey,
  makeRemoteServerKey,
  ServerPool,
} from "./server-pool.ts";
import {
  detectJupyterExecutable,
  spawnJupyterServer,
} from "./server-process.ts";
import { decodeV1, encodeV1 } from "./wire/protocol-v1.ts";
import { decodeDefault, encodeDefault } from "./wire/protocol-default.ts";
import { execute as executeImpl } from "./execute.ts";
import { interrupt as interruptImpl } from "./interrupt.ts";
import { restart as restartImpl } from "./restart.ts";

type ServerClientOptions = {
  kernelInfoTimeoutMs?: number;
  /** Test seam: override jupyter executable detection. */
  detectExecutable?: typeof detectJupyterExecutable;
  /** Test seam: override jupyter subprocess spawn. */
  spawnServer?: typeof spawnJupyterServer;
};

type ConnectResult = {
  socket: WebSocket;
  subprotocol: "v1" | "default";
  content: Record<string, unknown>;
};

type OpenResult = {
  socket: WebSocket;
  subprotocol: "v1" | "default";
};

/**
 * Kernel client for Jupyter Server HTTP+WebSocket mode.
 *
 * Lifecycle: start() → [onMessage()] → shutdown()
 * Idempotent shutdown: second call is a no-op.
 *
 * @category Kernel
 * @spec-id europa.contract.kernel-client-interface
 */
export class ServerKernelClient implements KernelClient {
  private readonly denops: Denops;
  private readonly config: EuropaConfig;
  private readonly pool: ServerPool;
  private readonly kernelInfoTimeoutMs: number;
  private readonly detectExecutable: typeof detectJupyterExecutable;
  private readonly spawnServer: typeof spawnJupyterServer;

  private _state: "idle" | "connected" | "disconnected" = "idle";
  private _serverKey: string | null = null;
  private _sessionId: string | null = null;
  private _socket: WebSocket | null = null;
  private _abort: AbortController | null = null;
  private _token: string | null = null;
  private _baseUrl: string | null = null;
  private _messageHandlers = new Set<(msg: KernelMessage) => void>();
  private _wsUrl: string | null = null;
  private _subprotocols: string[] = [];
  private _subprotocol: "v1" | "default" | null = null;
  private _runtime: KernelRuntime | null = null;
  /**
   * Persistent message dispatcher attached after WS open. Stored so it can be
   * removed via removeEventListener on shutdown / kernelInfo failure / WS swap;
   * anonymous attach would leak the receive op past the test boundary and
   * trip Deno's `sanitizeOps` checker (SC-010a).
   */
  private _persistentMessageHandler: ((e: MessageEvent) => void) | null = null;

  constructor(
    denops: Denops,
    config: EuropaConfig,
    pool: ServerPool,
    opts?: ServerClientOptions,
  ) {
    this.denops = denops;
    this.config = config;
    this.pool = pool;
    this.kernelInfoTimeoutMs = opts?.kernelInfoTimeoutMs ?? 30_000;
    this.detectExecutable = opts?.detectExecutable ?? detectJupyterExecutable;
    this.spawnServer = opts?.spawnServer ?? spawnJupyterServer;
  }

  /**
   * Establishes connection to an existing Jupyter Server.
   *
   * Flow: resolveToken → acquire pool handle → POST /api/sessions →
   * WebSocket open + subprotocol negotiation → kernel_info_request/reply.
   *
   * @spec-id europa.kernel.server-client.start
   * @spec-id europa.kernel.server-client.token-missing-external
   * @spec-id europa.kernel.server-client.connection-refused
   * @spec-id europa.kernel.server-client.kernel-info-timeout
   * @spec-id europa.kernel.server-client.external-attach
   */
  async start(opts: {
    kernelName: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<KernelRuntime> {
    const token = await resolveToken(
      this.denops,
      this.config,
      this.config.use_subprocess,
    );

    let serverKey: string;
    let baseUrl: string;

    if (this.config.use_subprocess) {
      const cwd = opts.cwd ?? Deno.cwd();
      const executable = await this.detectExecutable(cwd, this.config);
      serverKey = await makeLocalServerKey(executable);
      const handle = await this.pool.acquire(
        serverKey,
        () =>
          this.spawnServer(executable, {
            token,
            cwd,
            signal: opts.signal,
          }),
      );
      baseUrl = handle.url.replace(/\/+$/, "");
    } else {
      serverKey = makeRemoteServerKey(this.config.jupyter_url);
      baseUrl = this.config.jupyter_url.replace(/\/+$/, "");
      const url = new URL(baseUrl);
      const port = url.port
        ? parseInt(url.port, 10)
        : (url.protocol === "https:" ? 443 : 80);
      await this.pool.acquire(serverKey, () =>
        Promise.resolve({
          port,
          token,
          url: baseUrl,
        }));
    }

    let sessionData: { id: string; kernel: { id: string } };
    try {
      const resp = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: {
          Authorization: buildAuthHeader(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "",
          path: opts.cwd ?? "",
          type: "console",
          kernel: { name: opts.kernelName },
        }),
        signal: opts.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      sessionData = await resp.json() as { id: string; kernel: { id: string } };
    } catch (e) {
      await this.pool.release(serverKey);
      if (e instanceof TypeError) {
        throw new EuropaKernelError(
          "CONNECTION_REFUSED",
          `Cannot connect to ${baseUrl}`,
          e,
        );
      }
      throw e;
    }

    const sessionId = sessionData.id;
    const kernelId = sessionData.kernel.id;

    const abort = new AbortController();
    // Propagate opts.signal into the internal abort controller so that
    // kernelInfo() (called after _openWS returns) is also cancelled promptly
    // when the caller aborts the start operation.
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
    }
    const combinedSignal = opts.signal
      ? AbortSignal.any([abort.signal, opts.signal])
      : abort.signal;

    const subprotocols = buildSubprotocols(this.config, token);
    // jupyter_server selects only `v1.kernel.websocket.jupyter.org` from
    // subprotocols and does NOT parse token-suffixed subprotocols for auth.
    // Browser/Deno WebSocket cannot set the Authorization header either, so
    // the token must ride in the query string.
    const wsUrl = `${
      baseUrl.replace(/^http/, "ws")
    }/api/kernels/${kernelId}/channels?token=${encodeURIComponent(token)}`;

    // Open the WebSocket (subprotocol negotiation only; no kernel_info yet).
    let openResult: OpenResult;
    try {
      openResult = await this._openWS(wsUrl, subprotocols, combinedSignal);
    } catch (e) {
      await this.pool.release(serverKey);
      throw e;
    }

    const { socket, subprotocol } = openResult;

    // Save state before calling kernelInfo() so its onMessage handler fires.
    this._serverKey = serverKey;
    this._sessionId = sessionId;
    this._socket = socket;
    this._abort = abort;
    this._token = token;
    this._baseUrl = baseUrl;
    this._wsUrl = wsUrl;
    this._subprotocols = subprotocols;
    this._subprotocol = subprotocol;
    this._state = "connected";
    this._attachMessageListener(socket);

    // DRY: use public kernelInfo() for the handshake (shared with restart path).
    let reply: import("../../../schema/message.ts").KernelInfoReply;
    try {
      reply = await this.kernelInfo();
    } catch (e) {
      // Reset all state on handshake failure to leave the client clean.
      // Detach the persistent message listener and await the WS close event
      // before releasing the pool handle so that Deno's test sanitizer does
      // not flag a dangling receive op when the caller aborts mid-handshake
      // (SC-010a leak).
      this._detachMessageListener(socket);
      this._serverKey = null;
      this._sessionId = null;
      this._socket = null;
      this._abort = null;
      this._token = null;
      this._baseUrl = null;
      this._wsUrl = null;
      this._subprotocols = [];
      this._subprotocol = null;
      this._state = "idle";
      abort.abort();
      await this._closeAndWait(socket, 1000, "kernel_info failed");
      await this.pool.release(serverKey);
      throw e;
    }

    const langInfo = reply.language_info;
    const info: KernelInfo = {
      kernelId,
      sessionId,
      kernelName: opts.kernelName,
      connectionMode: "server",
      state: "idle" as KernelState,
      subprotocol,
      startedAt: new Date().toISOString(),
      languageInfo: langInfo
        ? {
          name: langInfo.name,
          version: langInfo.version,
          mimetype: langInfo.mimetype,
          file_extension: langInfo.file_extension,
        }
        : undefined,
      banner: reply.banner,
    };

    // @spec-id europa.session.state.exec-state-transition
    // @spec-id europa.session.state.cell-states-update
    const runtime: KernelRuntime = {
      client: this,
      serverKey,
      info,
      socket,
      abort,
      // Phase 3.3 additions (data-model.md §2.4)
      pendingRequests: new Map(),
      execState: "idle",
      cellStates: new Map(),
    };
    this._runtime = runtime;

    // SC-010a: abort propagation must reach kernel state within 100ms.
    // Decoupled from the WS close event because Windows can delay the close
    // (no TCP FIN when the peer process is killed) past the 100ms budget.
    abort.signal.addEventListener("abort", () => {
      const r = this._runtime;
      if (r && r.info.state !== "disconnected") {
        r.info.state = "disconnected";
        delete r.reconnect;
      }
    }, { once: true });

    this._attachReconnectLoop(socket);

    return runtime;
  }

  /**
   * Tears down the connection and releases the server pool handle.
   *
   * Order: abort → WS close(1000) → DELETE /api/sessions → pool.release().
   * Idempotent: second call is a no-op.
   *
   * @spec-id europa.kernel.server-client.shutdown
   * @spec-id europa.kernel.server-client.external-shutdown
   */
  async shutdown(): Promise<void> {
    if (this._state === "disconnected") return;
    this._state = "disconnected";

    const serverKey = this._serverKey;
    const sessionId = this._sessionId;
    const socket = this._socket;
    const abort = this._abort;
    const token = this._token;
    const baseUrl = this._baseUrl;
    this._serverKey = null;
    this._sessionId = null;
    this._socket = null;
    this._abort = null;
    this._token = null;
    this._baseUrl = null;
    this._wsUrl = null;
    this._subprotocols = [];
    this._runtime = null;

    abort?.abort();

    if (socket) {
      this._detachMessageListener(socket);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "shutdown");
      }
    }

    if (serverKey && sessionId && baseUrl) {
      try {
        await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
          method: "DELETE",
          headers: { Authorization: buildAuthHeader(token ?? "") },
        });
      } catch { /* ignore — kernel may already be gone */ }
    }

    if (serverKey) {
      await this.pool.release(serverKey);
    }
  }

  /**
   * Subscribes a handler to incoming KernelMessage events.
   *
   * @returns Idempotent unsubscribe function
   * @spec-id europa.kernel.server-client.on-message
   */
  onMessage(handler: (msg: KernelMessage) => void): () => void {
    this._messageHandlers.add(handler);
    return () => {
      this._messageHandlers.delete(handler);
    };
  }

  private _attachMessageListener(socket: WebSocket): void {
    const handler = (e: MessageEvent): void => {
      let msg: KernelMessage;
      try {
        if (e.data instanceof ArrayBuffer) {
          msg = decodeV1(new Uint8Array(e.data));
        } else {
          msg = decodeDefault(e.data as string);
        }
      } catch {
        return;
      }
      for (const h of this._messageHandlers) h(msg);
    };
    this._persistentMessageHandler = handler;
    socket.addEventListener("message", handler);
  }

  // Callers must invoke this before reassigning _socket (e.g. on reconnect
  // WS swap, kernelInfo failure, or shutdown) to release the receive op.
  private _detachMessageListener(socket: WebSocket): void {
    const handler = this._persistentMessageHandler;
    if (handler !== null) {
      socket.removeEventListener("message", handler);
      this._persistentMessageHandler = null;
    }
  }

  /**
   * Closes a WebSocket and resolves once the close event fires (or
   * immediately if it is already CLOSED). Mirrors the close-await pattern in
   * `_connectWS.rejectAfterClose` so callers in error / shutdown paths do not
   * leak in-flight WS receive ops past the test boundary.
   */
  private _closeAndWait(
    socket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      socket.addEventListener("close", () => resolve(), { once: true });
      try {
        socket.close(code, reason);
      } catch {
        // already closing — close listener will still fire
      }
    });
  }

  private _attachReconnectLoop(socket: WebSocket): void {
    socket.addEventListener("close", (ev) => {
      if (ev.code === 1000 || !this._runtime) return;
      // Abort listener already set state to "disconnected"; skip the loop to
      // avoid a transient "reconnecting" flicker after teardown.
      if (this._runtime.abort.signal.aborted) return;
      this._runReconnectLoop();
    }, { once: true });
  }

  /**
   * Exponential-backoff reconnection loop driven by config options.
   *
   * Mutates the retained KernelRuntime reference so kernelStatus() can
   * observe reconnect progress without a SessionStore update.
   *
   * @spec-id europa.kernel.server-client.reconnection
   */
  private async _runReconnectLoop(): Promise<void> {
    const runtime = this._runtime;
    if (!runtime) return;

    const max = this.config.wsReconnectMaxRetries;
    const signal = runtime.abort.signal;

    if (max === 0) {
      runtime.info.state = "disconnected";
      return;
    }

    runtime.info.state = "reconnecting";

    for (let attempt = 1; attempt <= max; attempt++) {
      if (signal.aborted) break;

      runtime.reconnect = { retry: attempt, max };

      const waitMs = this.config.wsReconnectInitialIntervalMs *
        Math.pow(this.config.wsReconnectMultiplier, attempt - 1);

      try {
        await delay(waitMs, { signal });
      } catch {
        break;
      }

      if (signal.aborted) break;

      try {
        const result = await this._connectWS(
          this._wsUrl!,
          this._subprotocols,
          signal,
        );
        const oldSocket = this._socket;
        runtime.socket = result.socket;
        runtime.info.state = "idle";
        delete runtime.reconnect;
        // Release the persistent message listener bound to the old socket
        // before reattaching to the new one; otherwise the receive op on
        // the dropped WS lingers until GC.
        if (oldSocket !== null) {
          this._detachMessageListener(oldSocket);
        }
        this._socket = result.socket;
        this._attachMessageListener(result.socket);
        this._attachReconnectLoop(result.socket);
        return;
      } catch {
        // continue to next attempt
      }
    }

    runtime.info.state = "disconnected";
    delete runtime.reconnect;
  }

  /**
   * @spec-id europa.kernel.server-client.abort-race
   */
  private _connectWS(
    wsUrl: string,
    subprotocols: string[],
    signal: AbortSignal,
  ): Promise<ConnectResult> {
    return new Promise<ConnectResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            "Aborted before WebSocket connect",
          ),
        );
        return;
      }

      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let resendIntervalId: ReturnType<typeof setInterval> | undefined;
      let onMessage: ((e: MessageEvent) => void) | undefined;
      let opened = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (resendIntervalId !== undefined) {
          clearInterval(resendIntervalId);
          resendIntervalId = undefined;
        }
        if (onMessage !== undefined) {
          // Detach on every reject path (abort/close/timeout) so Deno's
          // test sanitizer does not flag a dangling message receive op.
          ws.removeEventListener("message", onMessage);
          onMessage = undefined;
        }
      };

      // Defer reject until the WS is fully closed to prevent cross-test resource leaks.
      const rejectAfterClose = (err: EuropaKernelError) => {
        settle(() => {
          cleanup();
          if (ws.readyState === WebSocket.CLOSED) {
            reject(err);
          } else {
            ws.addEventListener("close", () => reject(err), { once: true });
            try {
              ws.close();
            } catch { /* already closing */ }
          }
        });
      };

      const onAbort = () => {
        rejectAfterClose(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            "Start aborted by signal",
          ),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const ws = new WebSocket(wsUrl, subprotocols);
      ws.binaryType = "arraybuffer";

      ws.addEventListener("error", () => {
        // 'error' fires before 'close' in Deno; wait for close so WS is fully done.
        settle(() => {
          cleanup();
          const err = new EuropaKernelError(
            "CONNECTION_REFUSED",
            "WebSocket connection failed",
          );
          if (ws.readyState === WebSocket.CLOSED) {
            reject(err);
          } else {
            ws.addEventListener("close", () => reject(err), { once: true });
          }
        });
      });

      ws.addEventListener("close", (ev) => {
        settle(() => {
          cleanup();
          if (!opened) {
            reject(
              new EuropaKernelError(
                "CONNECTION_REFUSED",
                `WebSocket closed before open: ${ev.code}`,
              ),
            );
          } else {
            reject(
              new EuropaKernelError(
                "KERNEL_INFO_FAILED",
                `WebSocket closed before kernel_info_reply: ${ev.code}`,
              ),
            );
          }
        });
      });

      ws.addEventListener("open", () => {
        opened = true;
        const proto = ws.protocol;
        const isV1 = proto !== "" && proto.startsWith("v1");

        timeoutId = setTimeout(() => {
          rejectAfterClose(
            new EuropaKernelError(
              "KERNEL_INFO_TIMEOUT",
              `kernel_info_reply not received within ${this.kernelInfoTimeoutMs}ms`,
            ),
          );
        }, this.kernelInfoTimeoutMs);

        onMessage = (e: MessageEvent) => {
          let msg: KernelMessage;
          try {
            if (e.data instanceof ArrayBuffer) {
              msg = decodeV1(new Uint8Array(e.data));
            } else {
              msg = decodeDefault(e.data as string);
            }
          } catch {
            return;
          }

          if (msg.header.msg_type !== "kernel_info_reply") return;

          settle(() => {
            cleanup();
            resolve({
              socket: ws,
              subprotocol: isV1 ? "v1" : "default",
              content: msg.content,
            });
          });
        };

        ws.addEventListener("message", onMessage);

        const clientSession = crypto.randomUUID();
        const sendInfoRequest = () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const req: KernelMessage = {
            header: {
              msg_id: crypto.randomUUID(),
              msg_type: "kernel_info_request",
              username: "europa",
              session: clientSession,
              date: new Date().toISOString(),
              version: "5.3",
            },
            parent_header: {},
            metadata: {},
            content: {},
            buffers: [],
          };
          if (isV1) {
            // new Uint8Array(typedArray) copies into a fresh ArrayBuffer,
            // satisfying strict WebSocket.send() typings in TS 5.7+.
            ws.send(new Uint8Array(encodeV1(req)));
          } else {
            ws.send(encodeDefault(req));
          }
        };

        // Send immediately, then retry every 1s until reply arrives or timeout.
        // ipykernel may not be ready to respond on the first message after WS open.
        sendInfoRequest();
        resendIntervalId = setInterval(sendInfoRequest, 1_000);
      });
    });
  }

  /**
   * Opens a WebSocket and resolves on the "open" event with socket + subprotocol.
   * Does NOT perform the kernel_info handshake — use kernelInfo() for that.
   */
  private _openWS(
    wsUrl: string,
    subprotocols: string[],
    signal: AbortSignal,
  ): Promise<OpenResult> {
    return new Promise<OpenResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            "Aborted before WebSocket connect",
          ),
        );
        return;
      }

      let settled = false;
      const done = (fn: () => void) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          fn();
        }
      };

      const rejectAfterClose = (err: EuropaKernelError) => {
        done(() => {
          if (ws.readyState === WebSocket.CLOSED) {
            reject(err);
          } else {
            ws.addEventListener("close", () => reject(err), { once: true });
            try {
              ws.close();
            } catch { /* already closing */ }
          }
        });
      };

      const onAbort = () =>
        rejectAfterClose(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            "Start aborted by signal",
          ),
        );
      signal.addEventListener("abort", onAbort, { once: true });

      const ws = new WebSocket(wsUrl, subprotocols);
      ws.binaryType = "arraybuffer";

      ws.addEventListener("error", () => {
        const err = new EuropaKernelError(
          "CONNECTION_REFUSED",
          "WebSocket connection failed",
        );
        if (ws.readyState === WebSocket.CLOSED) {
          done(() => reject(err));
        } else {
          ws.addEventListener("close", () => done(() => reject(err)), {
            once: true,
          });
        }
      });

      ws.addEventListener("close", (ev) => {
        // Only reject before open fires; after open the reconnect loop owns close.
        done(() =>
          reject(
            new EuropaKernelError(
              "CONNECTION_REFUSED",
              `WebSocket closed before open: ${ev.code}`,
            ),
          )
        );
      });

      ws.addEventListener("open", () => {
        const proto = ws.protocol;
        const isV1 = proto !== "" && proto.startsWith("v1");
        done(() =>
          resolve({ socket: ws, subprotocol: isV1 ? "v1" : "default" })
        );
      });
    });
  }

  /**
   * Sends a kernel_info_request on the current socket and returns the reply.
   *
   * Retries every 1 s until a matching kernel_info_reply arrives. No timeout
   * is applied here — the caller (kernelInfo()) wraps with AbortSignal.timeout.
   * Uses the onMessage pub/sub so the socket message listener must be attached.
   */
  private _kernelInfoInner(signal: AbortSignal): Promise<
    import("../../../schema/message.ts").KernelInfoReply
  > {
    type KernelInfoReply = import("../../../schema/message.ts").KernelInfoReply;
    const socket = this._socket;
    const isV1 = this._subprotocol === "v1";

    return new Promise<KernelInfoReply>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }

      const msgId = crypto.randomUUID();
      const clientSession = crypto.randomUUID();
      let resendId: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        unsub();
        if (resendId !== undefined) {
          clearInterval(resendId);
          resendId = undefined;
        }
      };

      const unsub = this.onMessage((msg) => {
        if (msg.header.msg_type !== "kernel_info_reply") return;
        const parentMsgId = (msg.parent_header as Record<string, unknown>)
          ?.msg_id;
        if (parentMsgId !== msgId) return;
        cleanup();
        resolve(msg.content as unknown as KernelInfoReply);
      });

      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const sendRequest = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const req: KernelMessage = {
          header: {
            msg_id: msgId,
            msg_type: "kernel_info_request",
            username: "europa",
            session: clientSession,
            date: new Date().toISOString(),
            version: "5.3",
          },
          parent_header: {},
          metadata: {},
          content: {},
          buffers: [],
        };
        if (isV1) {
          socket.send(new Uint8Array(encodeV1(req)));
        } else {
          socket.send(encodeDefault(req));
        }
      };

      // Send immediately, then retry every 1 s until the reply arrives.
      sendRequest();
      resendId = setInterval(sendRequest, 1_000);
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 3.3 methods
  // ---------------------------------------------------------------------------

  /**
   * Execute code on the kernel and yield each iopub/shell message.
   *
   * Delegates to `kernel/execute.ts`. The opts.msgId must match the
   * pendingRequests key (FR-003 shared UUID invariant).
   */
  execute(
    code: string,
    opts?: { signal?: AbortSignal; msgId?: string },
  ): AsyncIterable<KernelMessage> {
    if (!this._runtime) {
      throw new Error("execute: client not connected — call start() first");
    }
    return executeImpl(this._runtime, code, opts);
  }

  /**
   * Fetch kernel_info_reply on the open channel (single API call, no reconnect retry).
   *
   * Sends one kernel_info_request and resends every 1 s until a reply arrives
   * or `kernelInfoTimeoutMs` elapses (KERNEL_INFO_TIMEOUT). The "no retry"
   * refers to connection-level reconnects, not message-level resends.
   * Both start() and restart() delegate their handshakes here (DRY).
   *
   * @spec-id europa.kernel.server-client.kernel-info-public
   */
  async kernelInfo(): Promise<
    import("../../../schema/message.ts").KernelInfoReply
  > {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
      throw new EuropaKernelError(
        "KERNEL_INFO_FAILED",
        "kernelInfo: not connected — call start() first",
      );
    }
    const signals: AbortSignal[] = [
      AbortSignal.timeout(this.kernelInfoTimeoutMs),
    ];
    if (this._abort) signals.push(this._abort.signal);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    try {
      return await this._kernelInfoInner(signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new EuropaKernelError(
          "KERNEL_INFO_TIMEOUT",
          `kernel_info_reply not received within ${this.kernelInfoTimeoutMs}ms`,
        );
      }
      throw e;
    }
  }

  /**
   * Send REST POST /api/kernels/{kid}/interrupt.
   *
   * Delegates to kernel/interrupt.ts. The dispatcher layer (main.ts) owns
   * the idle-guard and reconnect-guard routing.
   */
  interrupt(): Promise<void> {
    if (!this._runtime || !this._baseUrl || !this._token) {
      return Promise.reject(
        new Error("interrupt: client not connected — call start() first"),
      );
    }
    return interruptImpl(this._runtime, this._baseUrl, this._token);
  }

  /**
   * Restart kernel via REST + WebSocket re-open + kernelInfo() re-handshake.
   *
   * Delegates to kernel/restart.ts. The onSocketReopen callback updates this
   * client's internal socket reference and re-attaches the message listener
   * before kernelInfo() subscribes, ensuring the reply is seen on the new WS.
   */
  restart(): Promise<void> {
    if (!this._runtime || !this._baseUrl || !this._token || !this._wsUrl) {
      return Promise.reject(
        new Error("restart: client not connected — call start() first"),
      );
    }
    return restartImpl(
      this._runtime,
      this._baseUrl,
      this._token,
      this._wsUrl,
      this._subprotocols,
      (socket) => {
        this._socket = socket;
        // Sync the fresh AbortController that restart.ts created so that
        // subsequent kernelInfo() does not see the already-aborted old signal.
        this._abort = this._runtime!.abort;
        this._attachMessageListener(socket);
        this._attachReconnectLoop(socket);
      },
    );
  }
}
