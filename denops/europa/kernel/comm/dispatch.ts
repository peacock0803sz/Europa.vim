/**
 * CommDispatcher — routes inbound `comm_*` KernelMessages.
 *
 * Subscribes to `client.onMessage` (via CommService.handleInbound). Filters
 * on `msg_type ∈ {comm_open, comm_msg, comm_close}` and runs three small
 * sub-dispatchers. Out-of-order `comm_msg` / `comm_close` arrivals are
 * buffered in a 200 ms per-comm_id grace queue (Jupyter Client Messaging
 * Spec gives no cross-channel order guarantee, so a short queue is the
 * minimum needed to avoid losing legitimate messages without masking real
 * routing bugs).
 *
 * Implements `specs/016-phase5-1-comm-protocol/contracts/comm-dispatch.md`.
 *
 * @module europa-kernel-comm-dispatch
 * @category Kernel
 */

import { Value } from "@sinclair/typebox/value";
import type {
  CommEntry,
  CommService,
} from "../../../../contracts/comm-service.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import {
  CommCloseContentSchema,
  CommMsgContentSchema,
  CommOpenContentSchema,
  type KernelMessage,
} from "../../../../schema/message.ts";
import { createCommHandle } from "./handle.ts";
import type { CommRegistry } from "./registry.ts";

const COMM_MSG_TYPES = new Set([
  "comm_open",
  "comm_msg",
  "comm_close",
]);

const GRACE_QUEUE_MS = 200;

interface GraceEntry {
  msgs: KernelMessage[];
  enqueuedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * CommDispatcher public surface — a single `handleInbound` entry point so
 * subscribers attach exactly one function reference. Internal helpers
 * (`cancelAllGrace`) are exposed for CommService.closeAll only.
 */
export interface CommDispatcher {
  handleInbound(msg: KernelMessage): void;
  cancelAllGrace(): void;
}

export interface CommDispatcherDeps {
  registry: CommRegistry;
  service: CommService;
  client: KernelClient;
}

/**
 * Build a CommDispatcher.
 *
 * @spec-id europa.kernel.comm.dispatch-open-accept
 * @spec-id europa.kernel.comm.dispatch-open-reject-duplicate
 * @spec-id europa.kernel.comm.dispatch-open-reject-unknown
 * @spec-id europa.kernel.comm.dispatch-msg
 * @spec-id europa.kernel.comm.dispatch-close
 * @spec-id europa.kernel.comm.grace-queue-buffer
 * @spec-id europa.kernel.comm.grace-queue-flush
 * @spec-id europa.kernel.comm.grace-queue-timeout
 */
export function createCommDispatcher(
  deps: CommDispatcherDeps,
): CommDispatcher {
  const graceQueue = new Map<string, GraceEntry>();

  function enqueueGrace(commId: string, msg: KernelMessage): void {
    const existing = graceQueue.get(commId);
    if (existing) {
      existing.msgs.push(msg);
      return;
    }
    const timeoutId = setTimeout(() => {
      graceQueue.delete(commId);
    }, GRACE_QUEUE_MS);
    graceQueue.set(commId, {
      msgs: [msg],
      enqueuedAt: Date.now(),
      timeoutId,
    });
  }

  function flushGraceQueue(commId: string, entry: CommEntry): void {
    const grace = graceQueue.get(commId);
    if (!grace) return;
    clearTimeout(grace.timeoutId);
    graceQueue.delete(commId);
    for (const m of grace.msgs) {
      if (m.header.msg_type === "comm_msg") {
        const content = m.content as { data?: Record<string, unknown> };
        entry.handle._fireOnMessage(content.data ?? {}, m.buffers);
        entry.lastActivityAt = Date.now();
      } else if (m.header.msg_type === "comm_close") {
        const content = m.content as { data?: Record<string, unknown> };
        entry.handle._fireOnClose(content.data ?? {}, m.buffers, "kernel");
        deps.registry.remove(commId);
        // Close terminates the comm; subsequent queued msgs are post-close
        // and the spec does not define their delivery, so drop them.
        return;
      }
    }
  }

  function cancelGrace(commId: string): void {
    const entry = graceQueue.get(commId);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    graceQueue.delete(commId);
  }

  function handleOpen(msg: KernelMessage): void {
    if (!Value.Check(CommOpenContentSchema, msg.content)) return;
    const { comm_id, target_name, target_module, data } = msg.content;

    if (deps.registry.get(comm_id)) {
      deps.client
        .sendComm("close", { comm_id, data: {} }, [], msg.header)
        .catch(() => {
          // Best-effort reject reply; ignore transport errors during the
          // refusal because the inbound message was already invalid.
        });
      return;
    }

    const handler = deps.service.lookupTargetHandler(target_name);
    if (!handler) {
      deps.service.sessionWarnOnceForTarget(target_name);
      deps.client
        .sendComm("close", { comm_id, data: {} }, [], msg.header)
        .catch(() => {});
      return;
    }

    const handleCandidate = createCommHandle({
      commId: comm_id,
      targetName: target_name,
      client: deps.client,
      onCloseRegistryRemove: () => deps.registry.remove(comm_id),
    });

    const accepted = handler({
      commId: comm_id,
      targetModule: target_module,
      data,
      buffers: msg.buffers,
      handle: handleCandidate,
    });

    if (accepted === null) {
      deps.client
        .sendComm("close", { comm_id, data: {} }, [], msg.header)
        .catch(() => {});
      return;
    }

    const now = Date.now();
    const entry: CommEntry = {
      commId: comm_id,
      targetName: target_name,
      targetModule: target_module,
      opener: "kernel",
      openedAt: now,
      lastActivityAt: now,
      handle: accepted,
    };
    deps.registry.insert(entry);
    flushGraceQueue(comm_id, entry);
  }

  function handleMsg(msg: KernelMessage): void {
    if (!Value.Check(CommMsgContentSchema, msg.content)) return;
    const { comm_id, data } = msg.content;
    const entry = deps.registry.get(comm_id);
    if (entry) {
      entry.handle._fireOnMessage(data, msg.buffers);
      entry.lastActivityAt = Date.now();
      return;
    }
    enqueueGrace(comm_id, msg);
  }

  function handleClose(msg: KernelMessage): void {
    if (!Value.Check(CommCloseContentSchema, msg.content)) return;
    const { comm_id, data } = msg.content;
    const entry = deps.registry.get(comm_id);
    if (!entry) {
      cancelGrace(comm_id);
      return;
    }
    entry.handle._fireOnClose(data, msg.buffers, "kernel");
    deps.registry.remove(comm_id);
  }

  return {
    handleInbound(msg: KernelMessage): void {
      if (!COMM_MSG_TYPES.has(msg.header.msg_type)) return;
      if (msg.header.msg_type === "comm_open") {
        handleOpen(msg);
      } else if (msg.header.msg_type === "comm_msg") {
        handleMsg(msg);
      } else {
        handleClose(msg);
      }
    },

    cancelAllGrace(): void {
      for (const [, entry] of graceQueue) clearTimeout(entry.timeoutId);
      graceQueue.clear();
    },
  };
}
