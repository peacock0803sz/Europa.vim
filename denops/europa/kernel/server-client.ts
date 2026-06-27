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
import type {
  Header,
  KernelInfoReply,
  KernelMessage,
} from "../../../schema/message.ts";
import type { WSConnectionState } from "./ws-types.ts";
import { buildAuthHeader, buildSubprotocols, resolveToken } from "./auth.ts";
import { EuropaKernelError } from "./errors.ts";
import { ServerPool } from "./server-pool.ts";
import {
  detectJupyterExecutable,
  spawnJupyterServer,
} from "./server-process.ts";
import { buildKernelMessage, execute as executeImpl } from "./execute.ts";
import { v7 as uuidV7 } from "@std/uuid";
import { encodeDefault } from "./wire/protocol-default.ts";
import { encodeV1 } from "./wire/protocol-v1.ts";
import { interrupt as interruptImpl } from "./interrupt.ts";
import { restart as restartImpl } from "./restart.ts";
import {
  attachMessageListener,
  detachMessageListener,
  onMessage as onMessageHelper,
} from "./message-dispatch.ts";
import { attachReconnectLoop } from "./ws-reconnect.ts";
import { closeAndWait, openWS } from "./ws-handshake.ts";
import { kernelInfo as kernelInfoHelper } from "./kernel-info-request.ts";
import { acquireServer, createSession } from "./session-api.ts";

type ServerClientOptions = {
  kernelInfoTimeoutMs?: number;
  /** Test seam: override jupyter executable detection. */
  detectExecutable?: typeof detectJupyterExecutable;
  /** Test seam: override jupyter subprocess spawn. */
  spawnServer?: typeof spawnJupyterServer;
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
export class ServerKernelClient implements KernelClient, WSConnectionState {
  private readonly denops: Denops;
  private readonly config: EuropaConfig;
  private readonly pool: ServerPool;
  readonly kernelInfoTimeoutMs: number;
  private readonly _detectExecutable: typeof detectJupyterExecutable;
  private readonly _spawnServer: typeof spawnJupyterServer;

  // WSConnectionState: config accessors
  get wsReconnectMaxRetries(): number {
    return this.config.wsReconnectMaxRetries;
  }
  get wsReconnectInitialIntervalMs(): number {
    return this.config.wsReconnectInitialIntervalMs;
  }
  get wsReconnectMultiplier(): number {
    return this.config.wsReconnectMultiplier;
  }

  // WSConnectionState: mutable WS fields
  wsSocket: WebSocket | null = null;
  wsUrl: string | null = null;
  wsSubprotocols: string[] = [];
  wsSubprotocol: "v1" | "default" | null = null;
  wsPersistentMessageHandler: ((e: MessageEvent) => void) | null = null;
  wsMessageHandlers: Set<(msg: KernelMessage) => void> = new Set();
  wsRuntime: KernelRuntime | null = null;
  wsAbort: AbortController | null = null;

  // Non-WS private state
  private _state: "idle" | "connected" | "disconnected" = "idle";
  private _serverKey: string | null = null;
  private _sessionId: string | null = null;
  private _abort: AbortController | null = null;
  private _token: string | null = null;
  private _baseUrl: string | null = null;

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
    this._detectExecutable = opts?.detectExecutable ?? detectJupyterExecutable;
    this._spawnServer = opts?.spawnServer ?? spawnJupyterServer;
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

    const { serverKey, baseUrl } = await acquireServer(
      this.config,
      this.pool,
      token,
      {
        cwd: opts.cwd,
        signal: opts.signal,
        detectExecutable: this._detectExecutable,
        spawnServer: this._spawnServer,
      },
    );

    let sessionId: string;
    let kernelId: string;
    try {
      ({ sessionId, kernelId } = await createSession(
        baseUrl,
        token,
        opts.kernelName,
        opts.cwd,
        opts.signal,
      ));
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

    const abort = new AbortController();
    // Propagate opts.signal into the internal abort controller so that
    // kernelInfo() (called after openWS returns) is also cancelled promptly.
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
    }
    const combinedSignal = opts.signal
      ? AbortSignal.any([abort.signal, opts.signal])
      : abort.signal;

    const subprotocols = buildSubprotocols(this.config, token);
    // Token in query string: Deno/browser WS cannot set Authorization header;
    // jupyter_server only parses v1 subprotocol, not token-suffixed ones.
    const wsUrl = `${
      baseUrl.replace(/^http/, "ws")
    }/api/kernels/${kernelId}/channels?token=${encodeURIComponent(token)}`;

    // Open the WebSocket (subprotocol negotiation only; no kernel_info yet).
    let socket: WebSocket;
    let subprotocol: "v1" | "default";
    try {
      ({ socket, subprotocol } = await openWS(
        wsUrl,
        subprotocols,
        combinedSignal,
      ));
    } catch (e) {
      await this.pool.release(serverKey);
      throw e;
    }

    // Commit state so kernelInfo()'s onMessage handler can fire.
    this._serverKey = serverKey;
    this._sessionId = sessionId;
    this.wsSocket = socket;
    this._abort = abort;
    this.wsAbort = abort;
    this._token = token;
    this._baseUrl = baseUrl;
    this.wsUrl = wsUrl;
    this.wsSubprotocols = subprotocols;
    this.wsSubprotocol = subprotocol;
    this._state = "connected";
    attachMessageListener(this, socket);

    let reply: KernelInfoReply;
    try {
      reply = await this.kernelInfo();
    } catch (e) {
      // Reset all state on handshake failure; detach listener and await close
      // so Deno's sanitizeOps does not flag a dangling receive op (SC-010a).
      detachMessageListener(this, socket);
      this._resetState();
      abort.abort();
      await closeAndWait(socket, 1000, "kernel_info failed");
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
    // @spec-id europa.session.state.kernel-runtime-cwd
    const runtime: KernelRuntime = {
      client: this,
      serverKey,
      info,
      socket,
      abort,
      pendingRequests: new Map(),
      execState: "idle",
      cellStates: new Map(),
      cwd: opts.cwd ?? Deno.cwd(),
    };
    this.wsRuntime = runtime;

    // SC-010a: abort propagation must reach kernel state within 100ms.
    this._attachAbortPropagation(abort);
    attachReconnectLoop(this, socket, (s) => this._reattachReconnect(s));
    return runtime;
  }

  /**
   * Register a { once: true } abort listener that sets runtime state to
   * "disconnected" (SC-010a). Must be called whenever a fresh AbortController
   * is assigned (start and post-restart).
   */
  private _attachAbortPropagation(abort: AbortController): void {
    abort.signal.addEventListener("abort", () => {
      const r = this.wsRuntime;
      if (r && r.info.state !== "disconnected") {
        r.info.state = "disconnected";
        delete r.reconnect;
      }
    }, { once: true });
  }

  /** Re-attaches the reconnect loop on a newly-obtained socket. */
  private _reattachReconnect(socket: WebSocket): void {
    attachReconnectLoop(this, socket, (s) => this._reattachReconnect(s));
  }

  /** Clear all nullable state fields (used on handshake failure). */
  private _resetState(): void {
    this._serverKey = null;
    this._sessionId = null;
    this.wsSocket = null;
    this._abort = null;
    this.wsAbort = null;
    this._token = null;
    this._baseUrl = null;
    this.wsUrl = null;
    this.wsSubprotocols = [];
    this.wsSubprotocol = null;
    this._state = "idle";
  }

  /**
   * Tears down the connection and releases the server pool handle.
   * Order: abort → WS close(1000) → DELETE /api/sessions → pool.release().
   * Idempotent: second call is a no-op.
   *
   * @spec-id europa.kernel.server-client.shutdown
   * @spec-id europa.kernel.server-client.external-shutdown
   */
  async shutdown(): Promise<void> {
    if (this._state === "disconnected") return;
    this._state = "disconnected";

    const serverKey = this._serverKey, sessionId = this._sessionId;
    const socket = this.wsSocket, abort = this._abort;
    const token = this._token, baseUrl = this._baseUrl;
    this._serverKey = null;
    this._sessionId = null;
    this.wsSocket = null;
    this._abort = null;
    this.wsAbort = null;
    this._token = null;
    this._baseUrl = null;
    this.wsUrl = null;
    this.wsSubprotocols = [];
    this.wsRuntime = null;

    abort?.abort();

    if (socket) {
      detachMessageListener(this, socket);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "shutdown");
    }

    if (serverKey && sessionId && baseUrl) {
      try {
        await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
          method: "DELETE",
          headers: { Authorization: buildAuthHeader(token ?? "") },
        });
      } catch { /* ignore — kernel may already be gone */ }
    }

    if (serverKey) await this.pool.release(serverKey);
  }

  /**
   * Subscribes a handler to incoming KernelMessage events.
   *
   * @returns Idempotent unsubscribe function
   * @spec-id europa.kernel.server-client.on-message
   */
  onMessage(handler: (msg: KernelMessage) => void): () => void {
    return onMessageHelper(this, handler);
  }

  /**
   * Execute code on the kernel and yield each iopub/shell message.
   * Delegates to `kernel/execute.ts`.
   */
  execute(
    code: string,
    opts?: { signal?: AbortSignal; msgId?: string },
  ): AsyncIterable<KernelMessage> {
    if (!this.wsRuntime) {
      throw new Error("execute: client not connected — call start() first");
    }
    return executeImpl(this.wsRuntime, code, opts);
  }

  /**
   * Fetch kernel_info_reply on the open channel. Both start() and restart()
   * delegate their handshakes here (DRY).
   */
  kernelInfo(): Promise<KernelInfoReply> {
    return kernelInfoHelper(this);
  }

  /**
   * Send REST POST /api/kernels/{kid}/interrupt.
   * Delegates to kernel/interrupt.ts.
   */
  interrupt(): Promise<void> {
    if (!this.wsRuntime || !this._baseUrl || !this._token) {
      return Promise.reject(
        new Error("interrupt: client not connected — call start() first"),
      );
    }
    return interruptImpl(this.wsRuntime, this._baseUrl, this._token);
  }

  /**
   * Restart kernel via REST + WebSocket re-open + kernelInfo() re-handshake.
   * Delegates to kernel/restart.ts.
   */
  restart(): Promise<void> {
    if (!this.wsRuntime || !this._baseUrl || !this._token || !this.wsUrl) {
      return Promise.reject(
        new Error("restart: client not connected — call start() first"),
      );
    }
    return restartImpl(
      this.wsRuntime,
      this._baseUrl,
      this._token,
      this.wsUrl,
      this.wsSubprotocols,
      (socket) => {
        this.wsSocket = socket;
        // Sync the fresh AbortController that restart.ts created.
        this._abort = this.wsRuntime!.abort;
        // wsAbort must match _abort so kernelInfo() uses the live signal
        // and does not see the already-aborted old controller.
        this.wsAbort = this._abort;
        // Re-attach abort→state propagation on the new controller (SC-010a).
        this._attachAbortPropagation(this._abort);
        this.wsSubprotocol = (socket.protocol !== "" &&
            socket.protocol.startsWith("v1"))
          ? "v1"
          : "default";
        attachMessageListener(this, socket);
        this._reattachReconnect(socket);
      },
    );
  }

  /**
   * Phase 5.1: send a comm_* message on the shell channel.
   *
   * Builds a Jupyter envelope, attaches the supplied parent_header (or `{}`
   * for frontend-initiated messages), encodes through the negotiated WS
   * subprotocol codec (v1 binary or default text JSON), then writes to the
   * live socket. The reconnect gate at the first line is the single site
   * where Phase 5.1 enforces the FR-024 / SC-012 contract.
   *
   * @spec-id europa.contract.kernel-client-send-comm
   */
  sendComm(
    verb: "open" | "msg" | "close",
    content: Record<string, unknown>,
    buffers: Uint8Array[] = [],
    parentHeader?: Header,
  ): Promise<void> {
    const runtime = this.wsRuntime;
    if (!runtime) {
      return Promise.reject(
        new Error("sendComm: client not connected — call start() first"),
      );
    }
    if (runtime.info.state === "reconnecting") {
      return Promise.reject(
        new EuropaKernelError(
          "KERNEL_RECONNECTING",
          `sendComm rejected: transport is reconnecting (verb=${verb})`,
        ),
      );
    }
    const envelope = buildKernelMessage(
      `comm_${verb}`,
      uuidV7.generate(),
      runtime.info.sessionId,
      content,
    );
    envelope.parent_header = parentHeader ?? {};
    envelope.buffers = buffers;
    const subprotocol = runtime.info.subprotocol ?? this.wsSubprotocol;
    const frame = subprotocol === "v1"
      ? new Uint8Array(encodeV1(envelope))
      : encodeDefault(envelope);
    try {
      runtime.socket.send(frame);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(
        new EuropaKernelError(
          "CONNECTION_REFUSED",
          `sendComm: socket send failed (verb=${verb})`,
          e,
        ),
      );
    }
  }
}
