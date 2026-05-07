/**
 * Contracts for the per-buffer undo / redo history system.
 *
 * `UndoHistory` is a hand-written interface (whitelist exception to
 * Constitution I) because the class holds mutable in-process state
 * (Promises, queues, stacks) that cannot be expressed in TypeBox.
 * See DESIGN.md §4.4 for the exemption policy.
 *
 * All hand-written types for the undo/redo feature are consolidated here
 * so that `denops/europa/` remains free of hand-written type declarations
 * (Constitution I §2).
 *
 * @module contracts/undo-history
 * @category Session
 */

import type { Cell, NotebookMetadata } from "../schema/notebook.ts";

// ---------------------------------------------------------------------------
// Structural snapshot (FR-014a)
// ---------------------------------------------------------------------------

/**
 * Structural snapshot of a single cell — outputs and execution_count excluded.
 *
 * Derived from the Cell union but with only the structural fields retained.
 * On restore, outputs / execution_count come from the live notebook (FR-014a).
 */
export type SnapshotCell =
  | Omit<
    Extract<Cell, { cell_type: "code" }>,
    "outputs" | "execution_count"
  >
  | Omit<Extract<Cell, { cell_type: "markdown" }>, never>
  | Omit<
    Extract<Cell, { cell_type: "raw" }>,
    never
  >;

/**
 * Structural-only snapshot of a Notebook.
 *
 * Contains `metadata` (verbatim) and `cells` (structural fields only).
 * This is the type stored in every `UndoEntry.snapshot`.
 *
 * @see `takeStructuralSnapshot` in `denops/europa/notebook/structural-snapshot.ts`
 */
export type NotebookStructuralSnapshot = {
  metadata: NotebookMetadata;
  cells: SnapshotCell[];
};

// ---------------------------------------------------------------------------
// Undo operation types
// ---------------------------------------------------------------------------

/** Identifies which mutation produced a given undo entry. */
export type UndoOpType =
  | "insertCell"
  | "deleteCell"
  | "moveCell"
  | "splitCell"
  | "joinCell"
  | "changeCellType"
  | "saveCellEdit";

// ---------------------------------------------------------------------------
// Affected-cell hints (FR-005a)
// ---------------------------------------------------------------------------

/**
 * Single-cell hint: the affected cell is exactly `cellId`.
 * Used by deleteCell, moveCell, changeCellType, saveCellEdit.
 */
export type SingleHint = { kind: "single"; cellId: string };

/**
 * Anchor hint: the affected cell is relative to an anchor.
 * `cellId === null` means top / bottom of the notebook.
 * Used by insertCell.
 */
export type AnchorHint = {
  kind: "anchor";
  cellId: string | null;
  position: "above" | "below";
};

/**
 * Split hint: the primary (upper) cell after a split.
 * Used by splitCell.
 */
export type SplitHint = { kind: "split"; primaryCellId: string };

/**
 * Join hint: the surviving cell after a join.
 * Used by joinCell.
 */
export type JoinHint = { kind: "join"; primaryCellId: string };

/**
 * Delete-resurrect hint: the cell that was deleted and may be resurrected.
 * Used for the redo side of deleteCell.
 */
export type DeleteResurrectHint = { kind: "delete-resurrect"; cellId: string };

/** Union of all 5 affected-cell hint kinds. */
export type UndoAffectedCellHint =
  | SingleHint
  | AnchorHint
  | SplitHint
  | JoinHint
  | DeleteResurrectHint;

// ---------------------------------------------------------------------------
// Scratch sync metadata (US3 / saveCellEdit)
// ---------------------------------------------------------------------------

/** Scratch buffer sync metadata stored in a saveCellEdit entry. */
export type ScratchSyncInfo = {
  cellId: string;
  /** Cell source text before the save — restored on undo. */
  preSource: string;
};

// ---------------------------------------------------------------------------
// UndoEntry
// ---------------------------------------------------------------------------

/**
 * A single item on the undo or redo stack.
 *
 * `snapshot` always describes "the state to restore when this entry is applied".
 * The push / pushUndoFront / pushRedoFront callers are responsible for setting
 * snapshot to the correct pre-mutation state.
 */
export type UndoEntry = {
  opType: UndoOpType;
  snapshot: NotebookStructuralSnapshot;
  /** Hint used to determine cursor position after an undo. */
  beforeHint: UndoAffectedCellHint;
  /** Hint used to determine cursor position after a redo. */
  afterHint: UndoAffectedCellHint;
  /** Present only for saveCellEdit entries (US3). */
  scratchSync?: ScratchSyncInfo;
};

// ---------------------------------------------------------------------------
// UndoHistoryProcessor
// ---------------------------------------------------------------------------

/**
 * Async callback invoked by the FIFO queue to process one undo or redo step.
 *
 * Implementations are registered via `UndoHistory.setProcessor`.
 * The processor is responsible for all side-effects: model rollback,
 * viewer re-render, cursor movement, and opposite-stack push.
 */
export type UndoHistoryProcessor = (kind: "undo" | "redo") => Promise<void>;

// ---------------------------------------------------------------------------
// UndoHistory interface
// ---------------------------------------------------------------------------

/**
 * Per-buffer undo / redo history with a FIFO sequential request queue.
 *
 * Lifecycle: created in `SessionStore.add`, disposed in `SessionStore.remove`.
 *
 * **Stack semantics**
 * - `push` adds to the undo stack and clears the redo stack (FR-007).
 * - `popUndo` / `popRedo` remove and return the top entry.
 * - `pushUndoFront` / `pushRedoFront` prepend to the stack without clearing
 *   the opposite stack — used by `processOne` when swapping snapshots.
 *
 * **Queue semantics (FR-023)**
 * - `enqueueUndo` / `enqueueRedo` schedule one step into a FIFO queue.
 * - The queue drains sequentially; a new step starts only after the previous
 *   processor call resolves.
 * - If the queue is full (≥ maxHistory items pending), the enqueue returns
 *   `false` and the caller should warn the user.
 *
 * @category Session
 */
export interface UndoHistory {
  /**
   * Push a new entry onto the undo stack and clear the redo stack.
   *
   * Called by every mutation dispatcher immediately before applying the change.
   * If the stack exceeds maxHistory after push, the oldest entry is evicted
   * (FIFO, FR-009).
   *
   * @spec-id europa.session.undo-history.push
   */
  push(entry: UndoEntry): void;

  /**
   * Schedule one undo step into the FIFO request queue.
   *
   * Returns `false` and does nothing if the queue already holds maxHistory
   * pending items (FR-023 queue overflow).
   *
   * @spec-id europa.session.undo-history.enqueue-undo
   */
  enqueueUndo(): boolean;

  /**
   * Schedule one redo step into the FIFO request queue.
   *
   * Returns `false` and does nothing if the queue already holds maxHistory
   * pending items (FR-023 queue overflow).
   *
   * @spec-id europa.session.undo-history.enqueue-redo
   */
  enqueueRedo(): boolean;

  /**
   * Register the async processor that handles one undo or redo step.
   *
   * Must be called exactly once, immediately after the session is created.
   * The processor is invoked by the queue drainer in FIFO order.
   *
   * @spec-id europa.session.undo-history.set-processor
   */
  setProcessor(processor: UndoHistoryProcessor): void;

  /**
   * Return the top entry of the undo stack without removing it.
   *
   * @internal
   */
  peekUndo(): UndoEntry | undefined;

  /**
   * Return the top entry of the redo stack without removing it.
   *
   * @internal
   */
  peekRedo(): UndoEntry | undefined;

  /**
   * Remove and return the top entry of the undo stack.
   *
   * Returns `undefined` when the stack is empty (FR-009 empty-stack).
   *
   * @spec-id europa.session.undo-history.pop-undo
   */
  popUndo(): UndoEntry | undefined;

  /**
   * Remove and return the top entry of the redo stack.
   *
   * Returns `undefined` when the stack is empty.
   *
   * @spec-id europa.session.undo-history.pop-redo
   */
  popRedo(): UndoEntry | undefined;

  /**
   * Prepend an entry to the front of the undo stack without clearing the redo stack.
   *
   * Used by `processOne` to return an entry to the undo stack on render failure,
   * or to push the redo-snapshot entry after a successful undo (snapshot swap).
   * Does not enforce the maxHistory cap — recovery path must never lose entries.
   *
   * @spec-id europa.session.undo-history.push-undo-front
   */
  pushUndoFront(entry: UndoEntry): void;

  /**
   * Prepend an entry to the front of the redo stack without clearing the undo stack.
   *
   * Used by `processOne` to push the undo-snapshot entry after a successful redo.
   * Does not enforce the maxHistory cap.
   *
   * @spec-id europa.session.undo-history.push-redo-front
   */
  pushRedoFront(entry: UndoEntry): void;

  /**
   * Return `true` if a processor call is currently in progress.
   *
   * @internal
   */
  getInFlight(): boolean;

  /**
   * Return the number of items currently waiting in the FIFO queue.
   *
   * @internal
   */
  getQueueLength(): number;

  /**
   * Return `{ undoSize, redoSize }` — sizes of the two stacks.
   *
   * @internal
   */
  getStackSizes(): { undoSize: number; redoSize: number };

  /**
   * Dispose this instance: drain the queue, prevent future enqueues,
   * and clear both stacks.
   *
   * Called by `SessionStore.remove` when a buffer is wiped out (FR-009 GC).
   *
   * @spec-id europa.session.undo-history.dispose
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function type for creating `UndoHistory` instances.
 *
 * The concrete implementation (`createUndoHistory`) lives in
 * `denops/europa/session/undo-history.ts`.
 */
export type UndoHistoryFactory = (maxHistory: number) => UndoHistory;
