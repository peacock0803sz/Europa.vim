/**
 * pendingRequests state machine helpers for kernel execute correlation.
 *
 * Five pure-procedure exports manage `KernelRuntime.pendingRequests` and
 * `KernelRuntime.cellStates` in lockstep, enforcing the state invariants
 * defined in `contracts/pending-requests.md`.
 *
 * @module denops/europa/session/pending-requests
 * @spec-id europa.kernel.correlation.pending-state-queued-to-sent
 * @spec-id europa.kernel.correlation.pending-remove-on-reply
 * @spec-id europa.kernel.correlation.cross-buffer-drop
 * @spec-id europa.kernel.correlation.parent-header-filter
 * @spec-id europa.session.state.pending-requests-set
 * @spec-id europa.session.state.pending-requests-remove
 */

import { v7 } from "@std/uuid";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";

/**
 * Enqueue a new execute request for `cellId` in buffer `bufnr`.
 *
 * Generates a v7 UUID as the Jupyter msg_id (FR-003 shared UUID invariant).
 * Sets `pendingRequests[msgId] = { state: 'queued' }` and
 * `cellStates[cellId] = 'queued'` atomically.
 *
 * @returns the new msgId (used as Jupyter execute_request msg_id)
 */
export function enqueue(
  runtime: KernelRuntime,
  bufnr: number,
  cellId: string,
): string {
  const msgId = v7.generate();
  if (runtime.pendingRequests.has(msgId)) {
    // Defensive: UUID v7 collision is astronomically unlikely
    throw new Error(`UUID collision — regenerate: ${msgId}`);
  }
  runtime.pendingRequests.set(msgId, {
    msgId,
    bufnr,
    cellId,
    state: "queued",
    enqueuedAt: Date.now(),
    sentAt: null,
  });
  runtime.cellStates.set(cellId, "queued");
  return msgId;
}

/**
 * Transition entry from 'queued' → 'sent' and set `cellStates[cellId] = 'busy'`.
 *
 * Throws if the entry is missing or already in 'sent' state (monotonic invariant).
 */
export function markSent(runtime: KernelRuntime, msgId: string): void {
  const entry = runtime.pendingRequests.get(msgId);
  if (!entry) {
    throw new Error(`markSent: entry not found for msgId ${msgId}`);
  }
  if (entry.state !== "queued") {
    throw new Error(
      `markSent: invalid state transition ${entry.state} → sent`,
    );
  }
  entry.state = "sent";
  entry.sentAt = Date.now();
  runtime.cellStates.set(entry.cellId, "busy");
}

/**
 * Remove entry after execute_reply is received (normal termination).
 *
 * Sets `cellStates[cellId] = 'idle'` only if the cell was in 'busy' state
 * (avoids clobbering an 'aborted' state written by an interrupt handler).
 * No-op if the entry was already removed (e.g., by abort path).
 */
export function complete(runtime: KernelRuntime, msgId: string): void {
  const entry = runtime.pendingRequests.get(msgId);
  if (!entry) return;
  runtime.pendingRequests.delete(msgId);
  if (runtime.cellStates.get(entry.cellId) === "busy") {
    runtime.cellStates.set(entry.cellId, "idle");
  }
}

/**
 * Drop a 'queued' entry for `cellId` without sending a network message.
 *
 * Only removes entries in `state === 'queued'`; 'sent' entries are untouched
 * (caller must use `:EuropaInterrupt` to stop a running cell, FR-023).
 *
 * @returns `true` if an entry was removed, `false` if no queued entry found
 */
export function cancelQueued(
  runtime: KernelRuntime,
  cellId: string,
): boolean {
  for (const [msgId, entry] of runtime.pendingRequests.entries()) {
    if (entry.cellId === cellId && entry.state === "queued") {
      runtime.pendingRequests.delete(msgId);
      runtime.cellStates.set(cellId, "idle");
      return true;
    }
  }
  return false;
}

/**
 * Abort all in-flight requests (used by restart / WS close / atexit).
 *
 * Marks all cellStates as 'aborted' and clears the pendingRequests Map.
 * The caller is responsible for setting `execState` after this call.
 */
export function abortAll(runtime: KernelRuntime): void {
  for (const entry of runtime.pendingRequests.values()) {
    runtime.cellStates.set(entry.cellId, "aborted");
  }
  runtime.pendingRequests.clear();
}
