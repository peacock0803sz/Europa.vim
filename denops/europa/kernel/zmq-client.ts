/**
 * ZmqKernelClient — KernelClient over a direct ZeroMQ connection (Phase 4.1).
 *
 * Attaches to an externally-started kernel via a connection_file: it parses the
 * file, lazy-imports npm:zeromq, connects 5 sockets, and confirms readiness with
 * a kernel_info handshake. The execute/iopub/render pipeline is reused unchanged
 * (this client only owns the ZMQ transport). Attach is non-owning, so shutdown
 * closes sockets without a shutdown_request and restart is refused.
 *
 * @module europa-kernel-zmq-client
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../../schema/config.ts";
import type {
  KernelClient,
  KernelRuntime,
  ZmqSocketSet,
} from "../../../contracts/kernel-client.ts";
import type { KernelInfo, KernelState } from "../../../schema/session.ts";
import type {
  KernelInfoReply,
  KernelMessage,
} from "../../../schema/message.ts";
import { EuropaKernelError } from "./errors.ts";
import { buildExecuteRequest, buildKernelMessage } from "./execute.ts";
import { parseConnectionFile } from "./connection-file.ts";
import { decodeZmq, encodeZmq } from "./wire/protocol-zmq.ts";

/** Dependencies injectable for tests (mirrors ServerClientOptions). */
export interface ZmqClientOptions {
  kernelInfoTimeoutMs?: number;
  /** Defaults to the real lazy import; specs inject an in-memory transport double. */
  importZmq?: () => Promise<typeof import("zeromq")>;
}

export class ZmqKernelClient implements KernelClient {
  readonly #denops: Denops;
  readonly #config: EuropaConfig;
  readonly #connectionFile: string;
  readonly #kernelInfoTimeoutMs: number;
  readonly #importZmq: () => Promise<typeof import("zeromq")>;

  readonly #handlers = new Set<(msg: KernelMessage) => void>();
  readonly #abort = new AbortController();
  #zmq?: ZmqSocketSet;
  #key = "";
  #scheme = "hmac-sha256";
  #sessionId = "";
  #closed = false;

  constructor(
    denops: Denops,
    config: EuropaConfig,
    connectionFile: string,
    opts?: ZmqClientOptions,
  ) {
    this.#denops = denops;
    this.#config = config;
    this.#connectionFile = connectionFile;
    this.#kernelInfoTimeoutMs = opts?.kernelInfoTimeoutMs ?? 10_000;
    this.#importZmq = opts?.importZmq ?? (() => import("zeromq"));
  }

  /**
   * Attach to the kernel described by the connection_file.
   *
   * @param opts - kernelName is ignored (the name comes from the file); cwd is
   *   the viewer notebook dir, a best-effort base for traceback relative paths
   * @returns the live KernelRuntime (zmq filled, socket undefined)
   * @throws EuropaKernelError CONNECTION_FILE_* / ZMQ_BINDING_UNAVAILABLE / KERNEL_INFO_TIMEOUT
   * @category Kernel
   * @spec-id europa.kernel.zmq-client.start-attach
   */
  async start(
    opts: { kernelName: string; cwd?: string; signal?: AbortSignal },
  ): Promise<KernelRuntime> {
    const cf = await parseConnectionFile(this.#connectionFile);
    this.#key = cf.key;
    this.#scheme = cf.signature_scheme;
    this.#sessionId = crypto.randomUUID();

    // Dynamic import confines a missing native binding / dropped --allow-ffi to
    // :EuropaAttach, so viewer + server mode stay unaffected (FR-013).
    let zmq: typeof import("zeromq");
    try {
      zmq = await this.#importZmq();
    } catch (e) {
      throw new EuropaKernelError(
        "ZMQ_BINDING_UNAVAILABLE",
        "zeromq native binding is unavailable; build it with `deno install --allow-scripts=npm:zeromq`",
        e,
      );
    }

    const sockets: ZmqSocketSet = {
      shell: new zmq.Dealer(),
      iopub: new zmq.Subscriber(),
      stdin: new zmq.Dealer(),
      control: new zmq.Dealer(),
      hb: new zmq.Request(),
    };
    const base = `tcp://${cf.ip}`;
    sockets.shell.connect(`${base}:${cf.shell_port}`);
    sockets.iopub.connect(`${base}:${cf.iopub_port}`);
    sockets.stdin.connect(`${base}:${cf.stdin_port}`);
    sockets.control.connect(`${base}:${cf.control_port}`);
    sockets.hb.connect(`${base}:${cf.hb_port}`);
    // @spec-id europa.kernel.zmq-client.slow-joiner-sync
    // Subscribe before the kernel_info handshake; readiness still keys off the
    // shell reply because SUB cannot fully beat the TCP slow-joiner race.
    sockets.iopub.subscribe("");
    this.#zmq = sockets;

    // Receive loops must run before the handshake so the reply is captured.
    this.#startReceiveLoop(sockets.shell);
    this.#startReceiveLoop(sockets.iopub);
    this.#startReceiveLoop(sockets.control);

    let reply: KernelInfoReply;
    try {
      reply = await this.kernelInfo();
    } catch (e) {
      // Close all sockets so the receive loops end and no op leaks (US1 AC#6).
      this.#closeSockets();
      this.#abort.abort();
      throw e;
    }

    const langInfo = reply.language_info;
    const info: KernelInfo = {
      kernelId: crypto.randomUUID(),
      sessionId: this.#sessionId,
      kernelName: cf.kernel_name ?? "",
      connectionMode: "zmq",
      state: "idle" as KernelState,
      subprotocol: "none",
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

    // @spec-id europa.contract.kernel-runtime-transport
    // ZMQ runtime: fill zmq, leave socket undefined; serverKey is a sentinel
    // (not in the ServerPool), so kernelStatus must branch on connectionMode.
    const runtime: KernelRuntime = {
      client: this,
      serverKey: "zmq",
      info,
      zmq: sockets,
      abort: this.#abort,
      pendingRequests: new Map(),
      execState: "idle",
      cellStates: new Map(),
      cwd: opts.cwd ?? Deno.cwd(),
    };
    return runtime;
  }

  /**
   * Tear down a non-owned attach: cancel pending ops and close the 5 sockets.
   * Never sends shutdown_request — Europa did not start this kernel (FR-010).
   *
   * @category Kernel
   * @spec-id europa.kernel.zmq-client.shutdown-non-owned
   */
  shutdown(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#abort.abort();
    this.#closeSockets();
    return Promise.resolve();
  }

  /**
   * Subscribe a handler to decoded incoming messages; returns an idempotent
   * unsubscribe.
   *
   * @category Kernel
   */
  onMessage(handler: (msg: KernelMessage) => void): () => void {
    this.#handlers.add(handler);
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.#handlers.delete(handler);
      }
    };
  }

  /**
   * Send one kernel_info_request on shell and resolve with the reply content.
   *
   * @returns kernel_info_reply content
   * @throws EuropaKernelError KERNEL_INFO_TIMEOUT when no reply arrives in time
   * @category Kernel
   * @spec-id europa.kernel.zmq-client.kernel-info-handshake
   */
  async kernelInfo(): Promise<KernelInfoReply> {
    const msgId = crypto.randomUUID();
    const req = buildKernelMessage(
      "kernel_info_request",
      msgId,
      this.#sessionId,
      {},
    );
    const replyPromise = this.#waitForReply("kernel_info_reply", msgId);
    await this.#zmq!.shell.send(encodeZmq(req, this.#key, this.#scheme));
    return await replyPromise as KernelInfoReply;
  }

  /**
   * Execute code and yield each correlated iopub/shell message until idle+reply.
   *
   * Runs its own correlation loop (D2): execute.ts is WS-only, so it is not
   * reused — but the envelope builders and completion logic mirror it so the
   * output is identical to server mode (SC-002).
   *
   * @category Kernel
   * @spec-id europa.kernel.zmq-client.execute
   */
  execute(
    code: string,
    opts?: { signal?: AbortSignal; msgId?: string },
  ): AsyncIterable<KernelMessage> {
    const msgId = opts?.msgId ?? crypto.randomUUID();
    const envelope = buildKernelMessage(
      "execute_request",
      msgId,
      this.#sessionId,
      buildExecuteRequest(code) as unknown as Record<string, unknown>,
    );
    return this.#executeStream(envelope, msgId, opts?.signal);
  }

  /** ZMQ interrupt lands in the US4 slice (T035). */
  interrupt(): Promise<void> {
    return Promise.reject(
      new Error("ZmqKernelClient.interrupt is implemented in the US4 slice"),
    );
  }

  /** ZMQ restart lands in the US4 slice (T035). */
  restart(): Promise<void> {
    return Promise.reject(
      new Error("ZmqKernelClient.restart is implemented in the US4 slice"),
    );
  }

  /** Resolve when a message of `msgType` parented by `parentMsgId` arrives. */
  #waitForReply(
    msgType: string,
    parentMsgId: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(this.#kernelInfoTimeoutMs);
      const onTimeout = () => {
        unsub();
        reject(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            `kernel_info handshake timed out after ${this.#kernelInfoTimeoutMs}ms`,
          ),
        );
      };
      timeout.addEventListener("abort", onTimeout, { once: true });
      const unsub = this.onMessage((msg) => {
        const parent = msg.parent_header as { msg_id?: string };
        if (msg.header.msg_type === msgType && parent.msg_id === parentMsgId) {
          timeout.removeEventListener("abort", onTimeout);
          unsub();
          resolve(msg.content);
        }
      });
    });
  }

  /** Correlation loop: yield messages parented by msgId until idle + reply. */
  async *#executeStream(
    envelope: KernelMessage,
    msgId: string,
    signal?: AbortSignal,
  ): AsyncIterable<KernelMessage> {
    // Combine the per-call signal with the client abort so shutdown() cancels an
    // in-flight execute instead of leaving it hung after the sockets close (AC#3).
    const abortSignal = signal
      ? AbortSignal.any([signal, this.#abort.signal])
      : this.#abort.signal;
    const buffer: KernelMessage[] = [];
    let resolveNext: ((msg: KernelMessage) => void) | null = null;
    let receivedReply = false;
    let receivedIdle = false;

    // Check before subscribing so an already-aborted signal cannot leak a handler.
    abortSignal.throwIfAborted();

    const unsubscribe = this.onMessage((msg) => {
      const ph = msg.parent_header as { msg_id?: string };
      if (!ph || ph.msg_id !== msgId) return;
      if (msg.header.msg_type === "execute_reply") receivedReply = true;
      if (
        msg.header.msg_type === "status" &&
        (msg.content as { execution_state?: string }).execution_state === "idle"
      ) receivedIdle = true;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve(msg);
      } else {
        buffer.push(msg);
      }
    });

    try {
      await this.#zmq!.shell.send(encodeZmq(envelope, this.#key, this.#scheme));
      while (!receivedReply || !receivedIdle || buffer.length > 0) {
        abortSignal.throwIfAborted();
        const msg = buffer.shift() ??
          await new Promise<KernelMessage>((resolve, reject) => {
            const onAbort = () => {
              resolveNext = null;
              reject(new DOMException("Aborted", "AbortError"));
            };
            resolveNext = (m: KernelMessage) => {
              abortSignal.removeEventListener("abort", onAbort);
              resolve(m);
            };
            abortSignal.addEventListener("abort", onAbort, { once: true });
          });
        yield msg;
      }
    } finally {
      unsubscribe();
    }
  }

  /** Per-socket receive loop: decode + HMAC-verify, drop+warn on mismatch. */
  #startReceiveLoop(socket: AsyncIterable<Uint8Array[]>): void {
    (async () => {
      try {
        for await (const frames of socket) {
          let msg: KernelMessage;
          try {
            msg = decodeZmq(frames, this.#key, this.#scheme);
          } catch (e) {
            // A rejected message must not stop the loop (SC-006).
            console.warn(
              `[europa-zmq] dropping message: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
            continue;
          }
          for (const h of this.#handlers) h(msg);
        }
      } catch {
        // Socket closed / aborted: the loop ends cleanly.
      }
    })();
  }

  #closeSockets(): void {
    const z = this.#zmq;
    if (!z) return;
    for (const s of [z.shell, z.iopub, z.stdin, z.control, z.hb]) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
  }
}
