/**
 * Per-buffer undo / redo history with a sequential FIFO request queue.
 *
 * `UndoHistoryImpl` holds two stacks (undo / redo) and a FIFO queue that
 * serialises concurrent undo/redo keystrokes into one-at-a-time processing.
 *
 * Design decisions (from plan.md Q3 / FR-023):
 * - FR-023: per-buffer FIFO queue. Each keystroke maps 1:1 to a step.
 *   Coalescing was rejected because "pressed N times, rolled back fewer"
 *   is unintuitive.
 * - The queue drains via Promise-based tail recursion in `processNext`.
 *   Each step schedules the next via `.then()`, so the JS call stack is
 *   never extended regardless of queue depth.
 *
 * @module denops/europa/session/undo-history
 * @category Session
 * @spec-id europa.session.undo-history.push
 * @spec-id europa.session.undo-history.fifo-overflow
 * @spec-id europa.session.undo-history.pop-undo
 * @spec-id europa.session.undo-history.pop-redo
 * @spec-id europa.session.undo-history.clear-redo
 * @spec-id europa.session.undo-history.enqueue-undo
 * @spec-id europa.session.undo-history.enqueue-redo
 * @spec-id europa.session.undo-history.queue-overflow
 * @spec-id europa.session.undo-history.empty-stack
 * @spec-id europa.session.undo-history.sequential-processing
 * @spec-id europa.session.undo-history.set-processor
 * @spec-id europa.session.undo-history.push-undo-front
 * @spec-id europa.session.undo-history.push-redo-front
 * @spec-id europa.session.undo-history.dispose
 */

import type {
  UndoEntry,
  UndoHistory,
  UndoHistoryProcessor,
} from "../../../contracts/undo-history.ts";

class UndoHistoryImpl implements UndoHistory {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  // FR-023 sequential FIFO queue state
  private requestQueue: ("undo" | "redo")[] = [];
  private inFlight = false;
  private disposed = false;
  private processor: UndoHistoryProcessor | undefined;

  constructor(private readonly maxHistory: number) {}

  push(entry: UndoEntry): void {
    this.redoStack = [];
    this.undoStack.push(entry);
    // FR-009: per-buffer stack cap; oldest entry evicted when exceeded
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
  }

  enqueueUndo(): boolean {
    if (this.disposed) return false;
    if (this.requestQueue.length >= this.maxHistory) return false;
    this.requestQueue.push("undo");
    if (!this.inFlight) {
      this.processNext();
    }
    return true;
  }

  enqueueRedo(): boolean {
    if (this.disposed) return false;
    if (this.requestQueue.length >= this.maxHistory) return false;
    this.requestQueue.push("redo");
    if (!this.inFlight) {
      this.processNext();
    }
    return true;
  }

  setProcessor(processor: UndoHistoryProcessor): void {
    this.processor = processor;
    // Restart draining if items were enqueued before the processor was registered.
    if (!this.inFlight && this.requestQueue.length > 0) {
      this.processNext();
    }
  }

  peekUndo(): UndoEntry | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): UndoEntry | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  popUndo(): UndoEntry | undefined {
    return this.undoStack.pop();
  }

  popRedo(): UndoEntry | undefined {
    return this.redoStack.pop();
  }

  pushUndoFront(entry: UndoEntry): void {
    // Adds to the "front" = top of stack (end of array, popped first by pop()).
    // Does not clear redo or enforce maxHistory cap — recovery path must
    // never lose entries (FR-018 snapshot swap after render failure).
    this.undoStack.push(entry);
  }

  pushRedoFront(entry: UndoEntry): void {
    // Adds to the "front" = top of stack (end of array, popped first by pop()).
    // Does not clear undo or enforce maxHistory cap.
    this.redoStack.push(entry);
  }

  getInFlight(): boolean {
    return this.inFlight;
  }

  getQueueLength(): number {
    return this.requestQueue.length;
  }

  getStackSizes(): { undoSize: number; redoSize: number } {
    return { undoSize: this.undoStack.length, redoSize: this.redoStack.length };
  }

  dispose(): void {
    this.disposed = true;
    this.requestQueue = [];
    this.undoStack = [];
    this.redoStack = [];
  }

  // Drain the FIFO queue one item at a time.
  // Uses a while-loop (not recursion) to avoid stack overflow under fast input.
  private processNext(): void {
    if (this.disposed || !this.processor || this.requestQueue.length === 0) {
      this.inFlight = false;
      return;
    }
    this.inFlight = true;
    const kind = this.requestQueue.shift()!;
    const proc = this.processor;

    // Wrap in Promise.resolve().then() so a synchronous throw from proc is
    // converted to a rejection and caught below, keeping inFlight in sync.
    Promise.resolve().then(() => proc(kind)).then(() => {
      if (!this.disposed && this.requestQueue.length > 0) {
        this.processNext();
      } else {
        this.inFlight = false;
      }
    }).catch(() => {
      if (!this.disposed && this.requestQueue.length > 0) {
        this.processNext();
      } else {
        this.inFlight = false;
      }
    });
  }
}

/**
 * Create a new per-buffer `UndoHistory` with the given stack cap.
 *
 * @param maxHistory - Maximum number of entries kept in each stack.
 *   Older entries are evicted FIFO when the cap is exceeded (FR-009).
 */
export function createUndoHistory(maxHistory: number): UndoHistory {
  return new UndoHistoryImpl(maxHistory);
}
