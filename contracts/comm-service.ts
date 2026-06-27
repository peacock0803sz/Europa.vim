/**
 * Phase 5.1 — Jupyter Comm protocol service surface.
 *
 * `CommService`, `CommHandle`, `CommTargetHandler`, `CommEntry`, and
 * `CommCloseOrigin` are hand-written interfaces because their fields hold
 * live closures, mutable subscriber Sets, and `KernelClient` references that
 * TypeBox cannot represent. The lint allowance lives in
 * `scripts/lint-no-handwritten-types.ts`.
 *
 * SoT hierarchy: data shapes belong in `schema/` (TypeBox);
 * live runtime objects belong here (contracts/).
 *
 * @module contracts/comm-service
 * @category Kernel
 * @spec-id europa.contract.comm-service
 */

import type { Denops } from "@denops/std";
import type { KernelClient } from "./kernel-client.ts";
import type { Header, KernelMessage } from "../schema/message.ts";

/**
 * Synthetic origin tag carried by `CommHandle.onClose` events so handlers can
 * tell kernel-initiated close from a frontend lifecycle terminator.
 */
export type CommCloseOrigin =
  | "kernel"
  | "frontend-shutdown"
  | "frontend-restart"
  | "frontend-wipeout";

/**
 * One open comm in the registry.
 *
 * `openedAt` and `lastActivityAt` are wall-clock milliseconds (`Date.now()`),
 * used by `:EuropaCommStatus` to compute `ageSeconds`. `handle` is the same
 * reference returned to the target handler — keeping it on the entry avoids
 * a parallel Map lookup at dispatch time.
 *
 * @spec-id europa.contract.comm-service
 */
export interface CommEntry {
  readonly commId: string;
  readonly targetName: string;
  readonly targetModule?: string;
  readonly opener: "kernel" | "frontend";
  readonly openedAt: number;
  lastActivityAt: number;
  readonly handle: CommHandle;
}

/**
 * Per-comm handle exposing send / close / onMessage / onClose to the
 * registered target handler. After `close()` (or kernel-initiated close)
 * subsequent `send` / `close` calls throw — there is no "half-open" state
 * because once a comm closes the kernel forgets the `comm_id`.
 *
 * @spec-id europa.kernel.comm.send-shell-msg
 * @spec-id europa.kernel.comm.send-shell-close
 */
export interface CommHandle {
  readonly commId: string;
  readonly targetName: string;

  /** True between open and close on either side. */
  isOpen(): boolean;

  /**
   * Send a `comm_msg` on the shell channel.
   * @throws EuropaKernelError code='KERNEL_RECONNECTING' during reconnect
   * @throws Error when the handle is already closed
   */
  send(
    data: Record<string, unknown>,
    buffers?: Uint8Array[],
  ): Promise<void>;

  /**
   * Send a `comm_close` on the shell channel. Idempotent: a second call
   * after the handle is already closed is a no-op.
   * @throws EuropaKernelError code='KERNEL_RECONNECTING' during reconnect
   */
  close(
    data?: Record<string, unknown>,
    buffers?: Uint8Array[],
  ): Promise<void>;

  /**
   * Subscribe to inbound `comm_msg` events for this comm.
   * @returns idempotent unsubscribe function
   */
  onMessage(
    handler: (data: Record<string, unknown>, buffers: Uint8Array[]) => void,
  ): () => void;

  /**
   * Subscribe to the close event (kernel-initiated or a synthetic
   * frontend-shutdown / restart / wipeout origin).
   * @returns idempotent unsubscribe function
   */
  onClose(
    handler: (
      data: Record<string, unknown>,
      buffers: Uint8Array[],
      origin: CommCloseOrigin,
    ) => void,
  ): () => void;

  /**
   * @internal Fired by CommDispatcher on inbound `comm_msg`. Not part of the
   * user-facing surface; declared here so dispatch.ts can drive subscribers
   * without a separate object identity.
   */
  _fireOnMessage(data: Record<string, unknown>, buffers: Uint8Array[]): void;

  /**
   * @internal Fired by CommDispatcher or CommService.closeAll. Drives the
   * onClose subscriber set and marks the handle closed.
   */
  _fireOnClose(
    data: Record<string, unknown>,
    buffers: Uint8Array[],
    origin: CommCloseOrigin,
  ): void;
}

/**
 * Factory dependencies for `createCommHandle`.
 *
 * `onCloseRegistryRemove` is a callback rather than a `CommRegistry`
 * reference so the handle stays registry-independent. This avoids a
 * circular dependency: the dispatcher builds the handle before inserting
 * the entry (the target handler is invoked with the handle and can return
 * `null` to reject — in which case the entry was never inserted and the
 * callback simply has nothing to remove).
 */
export interface CreateCommHandleDeps {
  commId: string;
  targetName: string;
  client: KernelClient;
  onCloseRegistryRemove: () => void;
}

/**
 * Build a CommHandle for either a frontend-initiated open or a
 * kernel-initiated open. Implementation lives in
 * `denops/europa/kernel/comm/handle.ts`.
 */
export declare function createCommHandle(
  deps: CreateCommHandleDeps,
): CommHandle;

/**
 * Target handler invoked when the kernel opens a comm with a registered
 * `target_name`. `opts.handle` is the pre-constructed `CommHandle`; returning
 * it accepts the open, returning `null` rejects (intentional decline) and
 * the dispatcher will reply with a `comm_close` reusing the original
 * `parent_header` for protocol correlation.
 *
 * @spec-id europa.contract.comm-service
 */
export type CommTargetHandler = (opts: {
  commId: string;
  targetModule?: string;
  data: Record<string, unknown>;
  buffers: Uint8Array[];
  handle: CommHandle;
}) => CommHandle | null;

/**
 * Per-`KernelRuntime` Comm protocol service facade. Owns the CommRegistry,
 * the CommDispatcher, and the target-handler Map. Lifecycle:
 *
 * - Created in the dispatcher when `KernelClient.start()` resolves
 *   (mirrors `iopubBatchScheduler` attachment).
 * - Subscribes to `client.onMessage(handleInbound)` exactly once at
 *   attachment time.
 * - `closeAll('restart' | 'wipeout')` clears the registry but keeps the
 *   handler Map alive. `closeAll('shutdown')` clears the registry; the
 *   service itself is GC'd along with the runtime.
 *
 * @spec-id europa.contract.comm-service
 */
export interface CommService {
  /**
   * Register a `target_name` → handler binding. Returns an idempotent
   * unregister function. Registering twice for the same target_name
   * replaces the previous handler (debug-logged).
   */
  registerHandler(
    targetName: string,
    handler: CommTargetHandler,
  ): () => void;

  /**
   * Frontend-initiated `comm_open`. Generates a UUID v7 `comm_id` if
   * omitted, inserts the entry with `opener: 'frontend'`, and rolls back
   * the insertion if `sendComm` rejects (preventing ghost entries when
   * the transport is reconnecting or refused).
   *
   * @spec-id europa.kernel.comm.send-shell-open
   */
  openComm(opts: {
    commId?: string;
    targetName: string;
    targetModule?: string;
    data?: Record<string, unknown>;
    buffers?: Uint8Array[];
  }): Promise<CommHandle>;

  /**
   * Snapshot of open comms, sorted by `openedAt` ascending. The array is a
   * shallow copy — mutating it does not affect the registry. Consumed by
   * `:EuropaCommStatus` via the dispatcher RPC.
   */
  list(): readonly CommEntry[];

  /**
   * @internal Lookup helper used by CommDispatcher when routing
   * `comm_open` to a registered handler.
   */
  lookupTargetHandler(targetName: string): CommTargetHandler | undefined;

  /**
   * @internal Emit a once-per-target_name warning to `:messages`. Called
   * by the dispatcher when an unknown target_name arrives so the operator
   * sees the rejection once rather than once per kernel-initiated msg.
   */
  sessionWarnOnceForTarget(targetName: string): void;

  /**
   * Public subscriber attached by `client.onMessage(...)`. Routes
   * `comm_open` / `comm_msg` / `comm_close` through the dispatcher and
   * no-ops for every other msg_type.
   */
  handleInbound(msg: KernelMessage): void;

  /**
   * @internal Called by the dispatcher's kernel-lifecycle RPCs
   * (`shutdownKernel`, `restartKernel`, `cleanup`). Fires synthetic close
   * events to every registered onClose subscriber and clears the registry.
   *
   * @spec-id europa.kernel.comm.close-all-shutdown
   * @spec-id europa.kernel.comm.close-all-restart
   * @spec-id europa.kernel.comm.close-all-wipeout
   */
  closeAll(reason: "shutdown" | "restart" | "wipeout"): Promise<void>;
}

/**
 * Build a CommService bound to a kernel client. The implementation lives
 * in `denops/europa/kernel/comm/service.ts`. The factory does NOT subscribe
 * to `client.onMessage` — that step is the caller's responsibility so the
 * subscriber attaches in exactly one site (the dispatcher's startKernel).
 */
export declare function createCommService(
  client: KernelClient,
  denops: Denops,
): CommService;

/**
 * Re-export of `Header` so callers building reject `comm_close` replies can
 * pass `msg.header` as `parentHeader` to `sendComm` without importing both
 * modules.
 */
export type { Header };
