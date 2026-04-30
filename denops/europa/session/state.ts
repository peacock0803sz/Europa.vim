/**
 * In-memory session store for open `.ipynb` buffers.
 *
 * `byKernel` always returns an empty array because kernel connections
 * are a Phase 3 concern.
 *
 * @category Session
 * @spec-id europa.session.state.store
 */

import type { Session } from "../../../schema/session.ts";

/**
 * In-memory registry mapping buffer numbers to open notebook sessions.
 * @spec-id europa.session.state.store
 */
export class SessionStore {
  private readonly store = new Map<number, Session>();

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
  }

  /** Always returns empty in Phase 2 — kernel connections are Phase 3. */
  byKernel(_kernelId: string): Session[] {
    return [];
  }

  all(): Session[] {
    return [...this.store.values()];
  }
}
