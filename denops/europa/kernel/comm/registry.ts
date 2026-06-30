/**
 * CommRegistry — Map of open CommEntries keyed by comm_id.
 *
 * Implements §3.1 of `specs/016-phase5-1-comm-protocol/data-model.md`.
 * The registry intentionally holds state only — timing concerns (grace
 * queue, lastActivityAt updates) live in `dispatch.ts`, and policy
 * concerns (target handlers, frontend-initiated opens) live in
 * `service.ts`. Splitting timing out of the registry keeps each module
 * single-purpose so the test surface stays small.
 *
 * @module europa-kernel-comm-registry
 * @category Kernel
 */

import type { CommEntry } from "../../../../contracts/comm-service.ts";

/**
 * In-memory store of open comm entries. Keyed by `comm_id`; list() returns
 * entries sorted by `openedAt` ascending so `:EuropaCommStatus` output is
 * stable across calls.
 *
 * @spec-id europa.kernel.comm.registry-insert
 * @spec-id europa.kernel.comm.registry-remove
 * @spec-id europa.kernel.comm.registry-list
 */
export interface CommRegistry {
  insert(entry: CommEntry): void;
  get(commId: string): CommEntry | undefined;
  remove(commId: string): void;
  list(): readonly CommEntry[];
  size(): number;
  clear(): void;
}

/**
 * Build a CommRegistry. Internal implementation: a single `Map<string,
 * CommEntry>`; list() snapshots and sorts on demand because list() is
 * called from the debug command, not from any hot path.
 */
export function createCommRegistry(): CommRegistry {
  const entries = new Map<string, CommEntry>();

  return {
    insert(entry: CommEntry): void {
      if (entries.has(entry.commId)) {
        throw new Error(
          `CommRegistry.insert: duplicate commId '${entry.commId}'; ` +
            `dispatch.ts must check before insert`,
        );
      }
      entries.set(entry.commId, entry);
    },

    get(commId: string): CommEntry | undefined {
      return entries.get(commId);
    },

    remove(commId: string): void {
      entries.delete(commId);
    },

    list(): readonly CommEntry[] {
      const arr = Array.from(entries.values());
      arr.sort((a, b) => a.openedAt - b.openedAt);
      return arr;
    },

    size(): number {
      return entries.size;
    },

    clear(): void {
      entries.clear();
    },
  };
}
