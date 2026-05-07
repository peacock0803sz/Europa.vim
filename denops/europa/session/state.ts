/**
 * In-memory session store for open `.ipynb` buffers.
 *
 * Phase 3.1 adds:
 * - `cellEditBuffers` map: cellId → scratchBufnr per viewer buffer
 * - `renderPlan` cache: stores the most recent RenderPlan per viewer buffer
 *
 * Phase 3.2 adds:
 * - `SessionRuntime` type: Session augmented with `kernelRuntime?: KernelRuntime`
 * - `byKernel(kernelId)`: find all sessions sharing a kernel (many-to-many ready)
 * - `update` now accepts `kernelRuntime` via the `SessionRuntime` augment patch
 *
 * @category Session
 */

import type { ScratchLookup, Session } from "../../../schema/session.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";
import type { SessionRuntime } from "../../../contracts/session-runtime.ts";
import type { IopubBatchScheduler } from "../../../contracts/iopub-batch-scheduler.ts";
import { createUndoHistory } from "./undo-history.ts";
import { takeStructuralSnapshot } from "../notebook/structural-snapshot.ts";
export type { SessionRuntime };

/**
 * In-memory registry mapping buffer numbers to open notebook sessions.
 * @spec-id europa.session.state.store
 * @spec-id europa.session.state.cell-edit-buffers
 * @spec-id europa.session.state.render-plan-cache
 * @spec-id europa.session.state.kernel-runtime-set
 * @spec-id europa.session.state.kernel-runtime-update
 * @spec-id europa.session.state.kernel-runtime-remove
 * @spec-id europa.session.state.by-kernel-many
 */
export class SessionStore {
  private readonly store = new Map<number, SessionRuntime>();

  /** viewerBufnr → (cellId → scratchBufnr) */
  private readonly cellEditBuffers = new Map<
    number,
    Map<string, number>
  >();

  /** viewerBufnr → most recent RenderPlan */
  private readonly renderPlans = new Map<number, RenderPlan>();

  constructor(private readonly maxHistory: number = 100) {}

  get(bufnr: number): SessionRuntime | undefined {
    return this.store.get(bufnr);
  }

  /**
   * Register a new session and initialise its undo history.
   *
   * @spec-id europa.session.state.undo-history-init
   * @spec-id europa.session.state.last-saved-snapshot-init
   */
  add(session: Session): void {
    const undoHistory = createUndoHistory(this.maxHistory);
    const lastSavedSnapshot = takeStructuralSnapshot(session.notebook);
    this.store.set(session.bufnr, {
      ...session,
      undoHistory,
      lastSavedSnapshot,
    });
  }

  update(
    bufnr: number,
    patch: Partial<Omit<SessionRuntime, "bufnr">>,
  ): void {
    const existing = this.store.get(bufnr);
    if (existing) {
      this.store.set(bufnr, { ...existing, ...patch });
    }
  }

  /**
   * Remove a session and dispose its undo history to prevent memory leaks.
   *
   * @spec-id europa.session.state.undo-history-gc-on-bufwipeout
   */
  remove(bufnr: number): void {
    // Dispose the undo history before deleting the session (FR-009 GC)
    this.store.get(bufnr)?.undoHistory.dispose();
    this.store.delete(bufnr);
    this.cellEditBuffers.delete(bufnr);
    this.renderPlans.delete(bufnr);
  }

  /**
   * Return all sessions whose kernelRuntime.info.kernelId matches.
   *
   * Phase 3.2 has 1 buffer = 1 kernel, so this returns 0 or 1 elements.
   * The many-to-many signature prepares for Phase 3.3 multi-buffer sharing.
   */
  byKernel(kernelId: string): SessionRuntime[] {
    const results: SessionRuntime[] = [];
    for (const session of this.store.values()) {
      if (session.kernelRuntime?.info.kernelId === kernelId) {
        results.push(session);
      }
    }
    return results;
  }

  all(): SessionRuntime[] {
    return [...this.store.values()];
  }

  /**
   * Convenience accessor for the IOPub batch scheduler attached to a session.
   *
   * Returns `undefined` when no session is registered for `bufnr`, when no
   * kernel runtime is attached, or when the scheduler has not been created yet
   * (the brief window between `client.start()` and `createIopubBatchScheduler`
   * in `startKernel`).
   */
  getIopubScheduler(bufnr: number): IopubBatchScheduler | undefined {
    return this.get(bufnr)?.kernelRuntime?.iopubBatchScheduler;
  }

  // --- Phase 3.1: cellEditBuffers map ---

  /**
   * Register a scratch buffer for a cell in a viewer buffer.
   *
   * @param viewerBufnr - The viewer buffer containing the cell.
   * @param cellId - The cell's id.
   * @param scratchBufnr - The scratch buffer number opened for this cell.
   */
  setCellEditBuffer(
    viewerBufnr: number,
    cellId: string,
    scratchBufnr: number,
  ): void {
    let map = this.cellEditBuffers.get(viewerBufnr);
    if (!map) {
      map = new Map();
      this.cellEditBuffers.set(viewerBufnr, map);
    }
    map.set(cellId, scratchBufnr);
  }

  /**
   * Remove a cell's scratch buffer registration.
   *
   * @param viewerBufnr - The viewer buffer.
   * @param cellId - The cell id to deregister.
   */
  removeCellEditBuffer(viewerBufnr: number, cellId: string): void {
    this.cellEditBuffers.get(viewerBufnr)?.delete(cellId);
  }

  /**
   * Find the viewer buffer and cell id corresponding to a scratch bufnr.
   *
   * @param scratchBufnr - The scratch buffer number.
   * @returns `{ viewerBufnr, cellId }` or `undefined` if not found.
   */
  findViewerByScratchBufnr(
    scratchBufnr: number,
  ): ScratchLookup | undefined {
    for (const [viewerBufnr, map] of this.cellEditBuffers) {
      for (const [cellId, sbn] of map) {
        if (sbn === scratchBufnr) return { viewerBufnr, cellId };
      }
    }
    return undefined;
  }

  /**
   * Get the scratch bufnr for a specific cellId in a viewer buffer.
   *
   * @returns The scratch bufnr or `undefined` if none registered.
   */
  getScratchBufnr(viewerBufnr: number, cellId: string): number | undefined {
    return this.cellEditBuffers.get(viewerBufnr)?.get(cellId);
  }

  /** Get all cellId → scratchBufnr entries for a viewer buffer. */
  getAllScratchBufnrs(
    viewerBufnr: number,
  ): ReadonlyMap<string, number> {
    return this.cellEditBuffers.get(viewerBufnr) ?? new Map();
  }

  // --- Phase 3.1: renderPlan cache ---

  /**
   * Cache the most recent RenderPlan for a viewer buffer.
   *
   * @param viewerBufnr - The viewer buffer.
   * @param plan - The RenderPlan to cache.
   */
  setRenderPlan(viewerBufnr: number, plan: RenderPlan): void {
    this.renderPlans.set(viewerBufnr, plan);
  }

  /**
   * Retrieve the cached RenderPlan for a viewer buffer.
   *
   * @param viewerBufnr - The viewer buffer.
   * @returns The cached plan or `undefined` if none stored yet.
   */
  getRenderPlan(viewerBufnr: number): RenderPlan | undefined {
    return this.renderPlans.get(viewerBufnr);
  }
}
