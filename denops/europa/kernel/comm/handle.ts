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
 * Build a CommHandle. The handle is mutable across open / closed state and
 * holds two subscriber Sets. Close is idempotent: once `_isOpen` flips to
 * false, send() / close() reject or no-op rather than re-firing subscribers.
 *
 * @spec-id europa.kernel.comm.send-shell-msg
 * @spec-id europa.kernel.comm.send-shell-close
 */
export function createCommHandle(deps: CreateCommHandleDeps): CommHandle {
  let isOpen = true;
  const messageHandlers = new Set<MsgHandler>();
  const closeHandlers = new Set<CloseHandler>();

  const handle: CommHandle = {
    commId: deps.commId,
    targetName: deps.targetName,

    isOpen(): boolean {
      return isOpen;
    },

    send(
      data: Record<string, unknown>,
      buffers: Uint8Array[] = [],
    ): Promise<void> {
      if (!isOpen) {
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
      if (!isOpen) return;
      isOpen = false;
      try {
        await deps.client.sendComm(
          "close",
          { comm_id: deps.commId, data },
          buffers,
        );
      } finally {
        // Drive onClose subscribers locally so a frontend-initiated close
        // is observable by handlers without waiting for any kernel reply.
        for (const h of closeHandlers) h(data, buffers, "kernel");
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
      if (!isOpen) return;
      isOpen = false;
      for (const h of closeHandlers) h(data, buffers, origin);
      deps.onCloseRegistryRemove();
    },
  };

  return handle;
}
