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
// Type-only import: erased at runtime, so naming these socket classes never
// loads the zeromq native binding (server / viewer stay FFI-free, FR-013).
import type { Dealer, Request, Subscriber } from "zeromq";

/**
 * Live ZMQ socket bundle for one attached kernel (DESIGN.md §3.7.4).
 *
 * Hand-written because npm:zeromq socket instances are non-serializable runtime
 * objects (same whitelist rationale as `socket: WebSocket` / `abort:
 * AbortController`). Each socket connects to `tcp://{ip}:{port}` from the
 * connection_file — the kernel binds and Europa connects (FR-003). Disposed by
 * ZmqKernelClient.shutdown(), which close()s all five without sending a
 * shutdown_request because attach is non-owning (FR-010).
 *
 * Roles: shell carries execute_request / kernel_info_request and their replies;
 * iopub subscribes to status / stream / results / display_data / error; stdin
 * is connected but unused (allow_stdin=false); control sends interrupt_request
 * only, never shutdown; hb is connected but not monitored this slice (Q2).
 *
 * @category Kernel
 */
export interface ZmqSocketSet {
  shell: Dealer;
  iopub: Subscriber;
  stdin: Dealer;
  control: Dealer;
  hb: Request;
}

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
  /** Server pool key; a `'zmq'` sentinel for attach (not in the ServerPool). */
  serverKey: string;
  info: KernelInfo;
  /**
   * WebSocket transport, server mode only. Exactly one of `socket` / `zmq` is
   * populated — invariant `(socket === undefined) !== (zmq === undefined)`.
   * ZMQ attach leaves this undefined and fills `zmq` instead (D5, FR-008).
   */
  socket?: WebSocket;
  /** Five live ZMQ sockets, attach mode only; see the invariant on `socket`. */
  zmq?: ZmqSocketSet;
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
  /**
   * Kernel working directory captured at spawn time. Preserved across
   * `restart()` (the kernel re-spawns inside the same process tree, so cwd
   * stays unchanged), disposed when the runtime is shut down. Used by the
   * Phase 3.8 traceback file-jump path to resolve relative paths.
   *
   * @spec-id europa.session.state.kernel-runtime-cwd
   */
  cwd: string;
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
   * Transport-specific. ServerKernelClient — subprocess mode: acquire server
   * from ServerPool → POST /api/sessions → WebSocket open with subprotocol
   * negotiation → kernel_info_request/reply (≤30s); attach mode skips the
   * ServerPool spawn and uses an existing remote server. ZmqKernelClient parses
   * a connection_file and connects 5 ZMQ sockets instead (its own codes:
   * CONNECTION_FILE_*, ZMQ_BINDING_UNAVAILABLE).
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
   * Order (server): abort() → WebSocket close(1000) → DELETE /api/sessions →
   * ServerPool.release() (refcount--; if 0 kills subprocess). ZmqKernelClient
   * instead closes its 5 ZMQ sockets and sends no shutdown_request, because
   * attach does not own the kernel process (FR-010).
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
   * Request a kernel interrupt. Transport-specific: ServerKernelClient sends
   * REST POST /api/kernels/{kid}/interrupt; ZmqKernelClient sends an
   * interrupt_request on the control channel best-effort (FR-011).
   */
  interrupt(): Promise<void>;

  /**
   * Restart the kernel. Transport-specific: ServerKernelClient uses REST POST
   * /api/kernels/{kid}/restart then re-opens the WebSocket and re-handshakes
   * with kernelInfo(); ZmqKernelClient rejects with RESTART_UNSUPPORTED because
   * pure attach does not own the kernel process (FR-012).
   */
  restart(): Promise<void>;

  // Phase 4+ reserved (not in Phase 3.3 interface):
  // complete(code: string, cursorPos: number): Promise<CompleteReply>
  // inspect(code: string, cursorPos: number, detail: 0 | 1): Promise<InspectReply>
}
