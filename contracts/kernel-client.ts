/**
 * Runtime interface for kernel clients.
 *
 * Hand-written interface authorized by DESIGN.md §3.7.2: TypeBox cannot
 * express the `AsyncIterable` return type of future `execute()` methods.
 * Phase 3.2 implements only `start`, `shutdown`, and `onMessage`.
 *
 * @module contracts/kernel-client
 * @spec-id europa.contract.kernel-client-interface
 */

import type { KernelInfoReply, KernelMessage } from "../schema/message.ts";
import type {
  CellExecState,
  KernelExecState,
  KernelInfo,
  PendingRequestEntry,
} from "../schema/session.ts";
import type { IopubBatchScheduler } from "./iopub-batch-scheduler.ts";

/**
 * Runtime augment field bag returned by `KernelClient.start()`.
 *
 * Committed verbatim to SessionStore via
 * `SessionStore.update(bufnr, { kernelRuntime: runtime })`.
 * The client owns the canonical bundle; the dispatcher must not
 * reconstruct info/socket/abort separately.
 *
 * @category Kernel
 */
export interface KernelRuntime {
  client: KernelClient;
  serverKey: string;
  info: KernelInfo;
  socket: WebSocket;
  abort: AbortController;
  reconnect?: { retry: number; max: number };
  // Phase 3.3 additions (data-model.md §2.4)
  pendingRequests: Map<string, PendingRequestEntry>;
  execState: KernelExecState;
  cellStates: Map<string, CellExecState>;
  // Phase 3.4 addition (data-model.md §1): optional because it is assigned
  // immediately after start() returns; undefined only between start() and the
  // first createIopubBatchScheduler() call inside startKernel().
  iopubBatchScheduler?: IopubBatchScheduler;
}

/**
 * Runtime method contract for kernel clients.
 *
 * Phase 3.2 implements `start`, `shutdown`, and `onMessage`.
 * Future phases will additively add `execute`, `kernelInfo`,
 * `complete`, `inspect`, `interrupt`, `restart`.
 *
 * @category Kernel
 */
export interface KernelClient {
  /**
   * Establishes the kernel connection.
   *
   * Subprocess mode: acquire server from ServerPool → POST /api/sessions
   * → WebSocket open with subprotocol negotiation → kernel_info_request/reply (≤30s).
   * Attach mode: skips ServerPool spawn; uses existing remote server.
   *
   * @throws EuropaKernelError — codes: JUPYTER_NOT_FOUND, SPAWN_TIMEOUT,
   *   SUBPROTOCOL_REJECTED, KERNEL_INFO_TIMEOUT, KERNEL_INFO_FAILED,
   *   TOKEN_MISSING, CONNECTION_REFUSED, CONFIG_INVALID, INVALID_ARGS
   * @spec-id europa.kernel.server-client.start
   */
  start(opts: {
    kernelName: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<KernelRuntime>;

  /**
   * Tears down the kernel connection.
   *
   * Order: abort() → WebSocket close(1000) → DELETE /api/sessions →
   * ServerPool.release() (refcount--; if 0 kills subprocess).
   * Idempotent: second call is a no-op when state is 'disconnected'.
   *
   * @spec-id europa.kernel.server-client.shutdown
   */
  shutdown(): Promise<void>;

  /**
   * Subscribes a handler to incoming KernelMessage events.
   *
   * @returns unsubscribe function (idempotent)
   * @spec-id europa.kernel.server-client.on-message
   */
  onMessage(handler: (msg: KernelMessage) => void): () => void;

  /**
   * Execute code on the kernel and yield each iopub/shell message.
   *
   * `opts.msgId` is the Jupyter msg_id to use (dispatcher-assigned UUID, FR-003).
   * If omitted, execute() generates one internally via @std/uuid/v7.
   */
  execute(
    code: string,
    opts?: { signal?: AbortSignal; msgId?: string },
  ): AsyncIterable<KernelMessage>;

  /**
   * Fetch kernel_info_reply from the kernel (single-shot, no retry, R04).
   *
   * Timeout controlled by g:europa_kernel_info_timeout_ms (default 10 000 ms).
   */
  kernelInfo(): Promise<KernelInfoReply>;

  /**
   * Send REST POST /api/kernels/{kid}/interrupt to the Jupyter server.
   */
  interrupt(): Promise<void>;

  /**
   * Restart kernel via REST POST /api/kernels/{kid}/restart,
   * then re-open the WebSocket and re-handshake with kernelInfo().
   */
  restart(): Promise<void>;

  // Phase 4+ reserved (not in Phase 3.3 interface):
  // complete(code: string, cursorPos: number): Promise<CompleteReply>
  // inspect(code: string, cursorPos: number, detail: 0 | 1): Promise<InspectReply>
}
