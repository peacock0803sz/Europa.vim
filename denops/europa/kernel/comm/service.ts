/**
 * CommService — per-KernelRuntime Comm protocol facade.
 *
 * Owns the CommRegistry, the CommDispatcher, and the target-handler Map.
 * Subscribers attach `handleInbound` to `client.onMessage` at start time
 * (the dispatcher does this so subscription happens at a single site).
 *
 * Implements §3.4 of `specs/016-phase5-1-comm-protocol/data-model.md`.
 *
 * @module europa-kernel-comm-service
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import { v7 } from "@std/uuid";
import type {
  CommEntry,
  CommHandle,
  CommService,
  CommTargetHandler,
} from "../../../../contracts/comm-service.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import type {
  CommOpenContent,
  KernelMessage,
} from "../../../../schema/message.ts";
import { createCommHandle } from "./handle.ts";
import { createCommDispatcher } from "./dispatch.ts";
import { createCommRegistry } from "./registry.ts";

/**
 * Build a CommService bound to a kernel client.
 *
 * The factory builds the registry, the dispatcher, and the target-handler
 * Map; it does NOT subscribe to `client.onMessage`. The caller (the
 * dispatcher's `startKernel`) wires the subscription so it happens once
 * per runtime, mirroring the iopubBatchScheduler attach pattern.
 *
 * @spec-id europa.contract.comm-service
 * @spec-id europa.kernel.comm.send-shell-open
 * @spec-id europa.kernel.comm.close-all-shutdown
 * @spec-id europa.kernel.comm.close-all-restart
 * @spec-id europa.kernel.comm.close-all-wipeout
 * @spec-id europa.kernel.comm.ws-reconnect-preserve
 * @spec-id europa.kernel.comm.send-during-reconnect
 * @spec-id europa.kernel.comm.no-persistence
 */
export function createCommService(
  client: KernelClient,
  denops: Denops,
): CommService {
  const registry = createCommRegistry();
  const targetHandlers = new Map<string, CommTargetHandler>();
  const warnedUnknownTargets = new Set<string>();

  const service: CommService = {
    registerHandler(
      targetName: string,
      handler: CommTargetHandler,
    ): () => void {
      targetHandlers.set(targetName, handler);
      return () => {
        if (targetHandlers.get(targetName) === handler) {
          targetHandlers.delete(targetName);
        }
      };
    },

    async openComm(opts: {
      commId?: string;
      targetName: string;
      targetModule?: string;
      data?: Record<string, unknown>;
      buffers?: Uint8Array[];
    }): Promise<CommHandle> {
      const commId = opts.commId ?? v7.generate();
      const handle = createCommHandle({
        commId,
        targetName: opts.targetName,
        client,
        onCloseRegistryRemove: () => registry.remove(commId),
      });
      const now = Date.now();
      const entry: CommEntry = {
        commId,
        targetName: opts.targetName,
        targetModule: opts.targetModule,
        opener: "frontend",
        openedAt: now,
        lastActivityAt: now,
        handle,
      };
      registry.insert(entry);
      try {
        // CommOpenContent must be assembled as one literal because the
        // discriminated `sendComm("open", …)` overload cannot accept a
        // mutated `Record<string, unknown>`. The conditional spread
        // prevents `target_module: undefined` from appearing on the wire.
        const content: CommOpenContent = {
          comm_id: commId,
          target_name: opts.targetName,
          data: opts.data ?? {},
          ...(opts.targetModule !== undefined
            ? { target_module: opts.targetModule }
            : {}),
        };
        await client.sendComm("open", content, opts.buffers ?? []);
      } catch (e) {
        // Must roll back the registry insertion because a failed sendComm
        // would otherwise leave a ghost entry that :EuropaCommStatus
        // displays as an open comm the kernel never agreed to.
        registry.remove(commId);
        throw e;
      }
      return handle;
    },

    list(): readonly CommEntry[] {
      return registry.list();
    },

    lookupTargetHandler(targetName: string): CommTargetHandler | undefined {
      return targetHandlers.get(targetName);
    },

    sessionWarnOnceForTarget(targetName: string): void {
      if (warnedUnknownTargets.has(targetName)) return;
      warnedUnknownTargets.add(targetName);
      const msg = `[europa] unknown comm target: ${targetName} (will reject)`;
      const escaped = msg.replace(/'/g, "''");
      denops
        .cmd(`echohl WarningMsg | echom '${escaped}' | echohl NONE`)
        .catch(() => {
          // Best-effort: warning is debug aid, not load-bearing.
        });
    },

    handleInbound(msg: KernelMessage): void {
      dispatcher.handleInbound(msg);
    },

    async closeAll(
      reason: "shutdown" | "restart" | "wipeout",
    ): Promise<void> {
      const origin = `frontend-${reason}` as const;
      // Snapshot before iterating because _fireOnClose mutates the registry
      // via the onCloseRegistryRemove callback. Per-entry try/catch must
      // isolate handle-level failures because closeAll is best-effort: a
      // throwing close handler on one comm cannot skip teardown of the
      // remaining comms (the lifecycle terminator must fire for every entry
      // or the kernel-side cleanup invariant is broken).
      const snapshot = registry.list().slice();
      for (const entry of snapshot) {
        try {
          entry.handle._fireOnClose({}, [], origin);
        } catch {
          // Swallow because every other entry must still see its terminator.
        }
      }
      registry.clear();
      dispatcher.cancelAllGrace();
      await Promise.resolve();
    },
  };

  const dispatcher = createCommDispatcher({ registry, service, client });
  return service;
}
