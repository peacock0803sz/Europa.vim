/**
 * CommHandle factory — registry-independent per-comm bridge.
 *
 * Implements §3.2 of `specs/016-phase5-1-comm-protocol/data-model.md`.
 * The factory takes `onCloseRegistryRemove` as a callback rather than a
 * registry reference because the dispatcher must build the handle BEFORE
 * inserting the entry (the target handler is invoked with the handle and
 * may decline the open by returning null). Coupling the handle to the
 * registry would invert that order and create a cycle.
 *
 * @module europa-kernel-comm-handle
 * @category Kernel
 */

import type {
  CommCloseOrigin,
  CommHandle,
  CreateCommHandleDeps,
} from "../../../../contracts/comm-service.ts";
import { EuropaKernelError } from "../errors.ts";

type MsgHandler = (
  data: Record<string, unknown>,
  buffers: Uint8Array[],
) => void;
type CloseHandler = (
  data: Record<string, unknown>,
  buffers: Uint8Array[],
  origin: CommCloseOrigin,
) => void;

/**
 * Build a CommHandle. The handle moves through a three-state machine
 * (`open` → `closing` → `closed`) because a frontend-initiated close has to
 * await the outbound `comm_close` while still observing concurrent
 * kernel-initiated close events. Collapsing the in-flight state to a single
 * boolean would either (a) lose the kernel race — silently swallowing
 * `_fireOnClose` while we await our own `sendComm` — or (b) make rollback
 * on `KERNEL_RECONNECTING` impossible. `closing` is the disambiguator: it
 * blocks `send()` like `closed` does, yet still lets `_fireOnClose` run and
 * mark the handle terminally `closed` so the awaiting `close()` learns the
 * race outcome on resume.
 *
 * @spec-id europa.kernel.comm.send-shell-msg
 * @spec-id europa.kernel.comm.send-shell-close
 */
export function createCommHandle(deps: CreateCommHandleDeps): CommHandle {
  let state: "open" | "closing" | "closed" = "open";
  const messageHandlers = new Set<MsgHandler>();
  const closeHandlers = new Set<CloseHandler>();

  const handle: CommHandle = {
    commId: deps.commId,
    targetName: deps.targetName,

    isOpen(): boolean {
      return state === "open";
    },

    send(
      data: Record<string, unknown>,
      buffers: Uint8Array[] = [],
    ): Promise<void> {
      if (state !== "open") {
        return Promise.reject(
          new EuropaKernelError(
            "INVALID_ARGS",
            `CommHandle.send: handle is closed (commId=${deps.commId})`,
          ),
        );
      }
      return deps.client.sendComm(
        "msg",
        { comm_id: deps.commId, data },
        buffers,
      );
    },

    async close(
      data: Record<string, unknown> = {},
      buffers: Uint8Array[] = [],
    ): Promise<void> {
      if (state !== "open") return;
      state = "closing";
      try {
        await deps.client.sendComm(
          "close",
          { comm_id: deps.commId, data },
          buffers,
        );
      } catch (e) {
        // Compare-and-swap: only restore to "open" if we are still "closing"
        // (i.e. no concurrent _fireOnClose ran during the await). Otherwise
        // a kernel-initiated close already finalised the handle with
        // origin="kernel" — we must not flip back to "open" because the
        // kernel-side comm is gone and the docstring forbids a half-open
        // state. The `state === "closing"` form is required because
        // TypeScript's flow analysis preserves the post-assignment narrowing
        // across the await and cannot see _fireOnClose's mutation.
        if (state === "closing") {
          state = "open";
        }
        throw e;
      }
      // Same compare-and-swap on the success branch. If state is still
      // "closing" we won the race and must finalise here; if a concurrent
      // _fireOnClose flipped it to "closed", subscribers already fired
      // (with origin="kernel") and the registry was removed.
      if (state === "closing") {
        state = "closed";
        for (const h of closeHandlers) h(data, buffers, "frontend-explicit");
        deps.onCloseRegistryRemove();
      }
    },

    onMessage(handler: MsgHandler): () => void {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onClose(handler: CloseHandler): () => void {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },

    _fireOnMessage(
      data: Record<string, unknown>,
      buffers: Uint8Array[],
    ): void {
      for (const h of messageHandlers) h(data, buffers);
    },

    _fireOnClose(
      data: Record<string, unknown>,
      buffers: Uint8Array[],
      origin: CommCloseOrigin,
    ): void {
      if (state === "closed") return;
      // State is either "open" (kernel-initiated close on an undisturbed
      // handle) or "closing" (a concurrent frontend close() is awaiting its
      // own sendComm). In both cases the kernel-side comm is now gone, so
      // transition to terminal "closed" — an awaiting close() will detect
      // this on resume and skip its own subscriber fire to avoid
      // double-delivery.
      state = "closed";
      for (const h of closeHandlers) h(data, buffers, origin);
      deps.onCloseRegistryRemove();
    },
  };

  return handle;
}
