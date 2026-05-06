/**
 * Hand-written contract for the IOPub batch scheduler.
 *
 * Authorized by Constitution §I exemption: `setTimeout` handle and class
 * lifecycle cannot be expressed as TypeBox schemas (same exemption as
 * `KernelClient.execute()` AsyncIterable return type).
 *
 * @module contracts/iopub-batch-scheduler
 * @spec-id europa.render.iopub-batch.tick-scheduling
 */

import type { Denops } from "@denops/std";
import type { KernelMessage } from "../schema/message.ts";
import type { Notebook } from "../schema/notebook.ts";
import type { Capabilities } from "../schema/capabilities.ts";

/**
 * Scheduler that accumulates IOPub messages and flushes them to the viewer
 * in batches, reducing RPC round-trips during kernel execution.
 *
 * One instance is created per `kernelRuntime` (i.e. per `:EuropaStartKernel`)
 * and lives for the full session (startKernel → shutdownKernel). Multiple
 * `runCell` / `runAll` calls reuse the same instance.
 *
 * @category Render
 */
export interface IopubBatchScheduler {
  /**
   * Add a message to the pending queue and start the 16 ms flush timer if
   * not already running.
   *
   * Silent no-op (debug log only) after `dispose()` has been called.
   *
   * @spec-id europa.render.iopub-batch.queue-accumulate
   */
  enqueue(msg: KernelMessage, cellId: string): void;

  /**
   * Drain the queue immediately without waiting for the next timer tick.
   *
   * Calls `applyPartialRenderPlan` via `@denops/std/batch` for one RPC
   * round-trip. Skips the RPC when the viewer buffer is hidden
   * (`bufwinid === -1`) but does not discard the in-memory state, because
   * `main.ts` has already updated `cell.outputs` via `applyMessageToCell`.
   *
   * Re-entrant calls while a flush is already in flight return the existing
   * Promise immediately (the `_flushing` guard prevents double execution).
   *
   * @spec-id europa.render.iopub-batch.empty-tick-skip
   * @spec-id europa.render.iopub-batch.reply-flush-immediate
   */
  flushNow(): Promise<void>;

  /**
   * Flush any remaining queue entries, cancel the timer, and mark the
   * scheduler as disposed. Subsequent `enqueue` calls are silently dropped.
   * Idempotent: calling `dispose()` more than once is safe.
   *
   * @spec-id europa.render.iopub-batch.tick-scheduling
   */
  dispose(): Promise<void>;
}

/**
 * Create a new `IopubBatchScheduler` bound to a specific viewer buffer and
 * notebook.
 *
 * @param deps.denops      - Denops handle for RPC. Captured at construction.
 * @param deps.bufnr       - Viewer buffer number. Used for hidden-buffer detection.
 * @param deps.getNotebook - Getter that returns the current live Notebook.
 *   Called on every flush so structural edits (insert/delete/move cell) that
 *   swap the session notebook are always reflected (no stale snapshot).
 * @param deps.caps        - Host capabilities (`vim` | `nvim`). Captured at
 *   construction and forwarded to `applyPartialRenderPlan`.
 * @param deps.tickMs      - Flush interval in milliseconds. Hard-coded to 16 ms
 *   per DESIGN.md §8.4 / §11.2 (Q1=A). Overridable only in tests.
 *
 * @spec-id europa.render.iopub-batch.tick-scheduling
 */
export declare function createIopubBatchScheduler(deps: {
  denops: Denops;
  bufnr: number;
  getNotebook: () => Notebook;
  caps: Capabilities;
  tickMs?: number;
}): IopubBatchScheduler;
