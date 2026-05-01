/**
 * In-memory session store for open `.ipynb` buffers.
 *
 * Phase 3.1 adds:
 * - `cellEditBuffers` map: cellId → scratchBufnr per viewer buffer
 * - `renderPlan` cache: stores the most recent RenderPlan per viewer buffer
 *
 * `byKernel` always returns an empty array because kernel connections
 * are a Phase 3 concern.
 *
 * @category Session
 */

import type { ScratchLookup, Session } from "../../../schema/session.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

/**
 * In-memory registry mapping buffer numbers to open notebook sessions.
 * @spec-id europa.session.state.store
 * @spec-id europa.session.state.cell-edit-buffers
 * @spec-id europa.session.state.render-plan-cache
 */
export class SessionStore {
  private readonly store = new Map<number, Session>();

  /** viewerBufnr → (cellId → scratchBufnr) */
  private readonly cellEditBuffers = new Map<
    number,
    Map<string, number>
  >();

  /** viewerBufnr → most recent RenderPlan */
  private readonly renderPlans = new Map<number, RenderPlan>();

  get(bufnr: number): Session | undefined {
    return this.store.get(bufnr);
  }

  add(session: Session): void {
    this.store.set(session.bufnr, session);
  }

  update(bufnr: number, patch: Partial<Omit<Session, "bufnr">>): void {
    const existing = this.store.get(bufnr);
    if (existing) {
      this.store.set(bufnr, { ...existing, ...patch });
    }
  }

  remove(bufnr: number): void {
    this.store.delete(bufnr);
    this.cellEditBuffers.delete(bufnr);
    this.renderPlans.delete(bufnr);
  }

  /** Always returns empty in Phase 2 — kernel connections are Phase 3. */
  byKernel(_kernelId: string): Session[] {
    return [];
  }

  all(): Session[] {
    return [...this.store.values()];
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
   * Used by `saveCellEdit` / `closeCellEdit` to reverse-look up from the
   * scratch buffer's bufnr to the viewer session it belongs to.
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
   * Called after each successful `applyRenderPlan` so that internal RPCs
   * (e.g. `lineToCellId`) can access the latest `cellRanges` without
   * rebuilding the plan.
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
