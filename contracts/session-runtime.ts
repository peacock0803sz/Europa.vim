/**
 * Augmented session type that includes kernel runtime state.
 *
 * `SessionRuntime` is a hand-written augment type (whitelist exception to
 * Constitution I) because the `WebSocket` and `AbortController` types cannot
 * be expressed in TypeBox. See DESIGN.md §4.4.
 *
 * `SessionRuntime` is canonically defined here and re-exported by
 * `denops/europa/session/state.ts` for in-process consumers.
 *
 * @module contracts/session-runtime
 */

import type { LspMirrorState, Session } from "../schema/session.ts";
import type { KernelRuntime } from "./kernel-client.ts";
import type {
  NotebookStructuralSnapshot,
  UndoHistory,
} from "./undo-history.ts";

/**
 * Runtime session augmented with live kernel connection state and undo history.
 *
 * The base `Session` schema tracks serializable state.
 * `SessionRuntime` adds in-process runtime objects that cannot be serialized.
 */
export type SessionRuntime = Session & {
  kernelRuntime?: KernelRuntime;
  /**
   * Per-buffer undo / redo history.
   * Initialised by SessionStore.add(), disposed by SessionStore.remove().
   * @spec-id europa.session.state.undo-history-init
   */
  undoHistory: UndoHistory;
  /**
   * Structural snapshot of the notebook as of the last disk save (`:w`).
   * Used by processOne to determine the &modified state after undo/redo (FR-015).
   * @spec-id europa.session.state.last-saved-snapshot-init
   */
  lastSavedSnapshot?: NotebookStructuralSnapshot;
  /**
   * On-disk `.py` notebook mirror state for LSP enablement (Phase 3.9).
   * Present only when g:europa_lsp_enable is active AND the notebook resolves
   * to filetype "python" (FR-004); absent otherwise (= 004 acwrite scratch
   * fallback, no mirror materialized). Materialized lazily at the first
   * :EuropaEditCell (not at viewer open), regenerated wholesale after
   * saveCellEdit / cell insert/delete/move/type-change, cleaned on BufWipeout
   * (delete mirrorPath) + process exit (delete the file for a project mirror;
   * remove the per-session cache mirrorDir for an unsaved notebook) — never
   * workspaceRoot. NOT serialized (FR-016 / FR-017 / FR-018, research §8/§9).
   * @spec-id europa.view.lsp.edit-cell-region
   */
  lspMirror?: LspMirrorState;
};
