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
import { buildAuthHeader, buildSubprotocols, resolveToken } from "./auth.ts";
import { EuropaKernelError } from "./errors.ts";
import { makeRemoteServerKey, ServerPool } from "./server-pool.ts";
import { decodeV1, encodeV1 } from "./wire/protocol-v1.ts";
import { decodeDefault, encodeDefault } from "./wire/protocol-default.ts";

type ServerClientOptions = {
  kernelInfoTimeoutMs?: number;
};

type ConnectResult = {
  socket: WebSocket;
  subprotocol: "v1" | "default";
  content: Record<string, unknown>;
};

/**
 * Kernel client for Jupyter Server HTTP+WebSocket mode.
 *
 * Lifecycle: start() → [onMessage()] → shutdown()
 * Idempotent shutdown: second call is a no-op.
 *
 * @category Kernel
 */
export class ServerKernelClient implements KernelClient {
  private readonly denops: Denops;
  private readonly config: EuropaConfig;
  private readonly pool: ServerPool;
  private readonly kernelInfoTimeoutMs: number;

  private _state: "idle" | "connected" | "disconnected" = "idle";
  private _serverKey: string | null = null;
  private _sessionId: string | null = null;
  private _socket: WebSocket | null = null;
  private _abort: AbortController | null = null;
  private _token: string | null = null;
  private _messageHandlers = new Set<(msg: KernelMessage) => void>();

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

    const serverKey = makeRemoteServerKey(this.config.jupyter_url);
    const baseUrl = this.config.jupyter_url.replace(/\/+$/, "");

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
    const combinedSignal = opts.signal
      ? AbortSignal.any([abort.signal, opts.signal])
      : abort.signal;

    const subprotocols = buildSubprotocols(this.config, token);
    const wsUrl = `${
      baseUrl.replace(/^http/, "ws")
    }/api/kernels/${kernelId}/channels`;

    let wsResult: ConnectResult;
    try {
      wsResult = await this._connectWS(wsUrl, subprotocols, combinedSignal);
    } catch (e) {
      await this.pool.release(serverKey);
      throw e;
    }

    const { socket, subprotocol, content } = wsResult;

    const langInfo = content.language_info as
      | Record<string, string>
      | undefined;
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
          name: langInfo.name ?? "",
          version: langInfo.version ?? "",
          mimetype: langInfo.mimetype,
          file_extension: langInfo.file_extension,
        }
        : undefined,
      banner: typeof content.banner === "string" ? content.banner : undefined,
    };

    this._serverKey = serverKey;
    this._sessionId = sessionId;
    this._socket = socket;
    this._abort = abort;
    this._token = token;
    this._state = "connected";

    socket.addEventListener("message", (e) => {
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
      for (const handler of this._messageHandlers) handler(msg);
    });

    return { client: this, serverKey, info, socket, abort };
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
    this._serverKey = null;
    this._sessionId = null;
    this._socket = null;
    this._abort = null;
    this._token = null;

    abort?.abort();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "shutdown");
    }

    if (serverKey && sessionId) {
      const baseUrl = this.config.jupyter_url.replace(/\/+$/, "");
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

  /**
   * @spec-id europa.kernel.server-client.abort-race
   * @spec-id europa.kernel.server-client.reconnection
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
      let opened = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
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

        const onMessage = (e: MessageEvent) => {
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

          ws.removeEventListener("message", onMessage);
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

        const req: KernelMessage = {
          header: {
            msg_id: crypto.randomUUID(),
            msg_type: "kernel_info_request",
            username: "europa",
            session: crypto.randomUUID(),
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
      });
    });
  }
}
