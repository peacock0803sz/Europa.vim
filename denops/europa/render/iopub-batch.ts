/**
 * IOPub batch scheduler — accumulates kernel messages and flushes them to the
 * viewer in 16 ms intervals, reducing RPC round-trips during streaming execution.
 *
 * @module denops/europa/render/iopub-batch
 * @internal
 * @category Render
 */

import { batch } from "@denops/std/batch";
import type { Denops } from "@denops/std";
import type { KernelMessage } from "../../../schema/message.ts";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { IopubBatchScheduler } from "../../../contracts/iopub-batch-scheduler.ts";
import { applyPartialRenderPlan } from "./partial-render.ts";

// 16ms is the DESIGN.md §8.4/§11.2 hard-coded value (Q1=A); making it
// configurable was rejected as YAGNI.
const DEFAULT_TICK_MS = 16;

type QueueEntry = { msg: KernelMessage; cellId: string; arrivedAt: number };

class IopubBatchSchedulerImpl implements IopubBatchScheduler {
  private readonly queue: QueueEntry[] = [];
  private timer: number | null = null;
  // Holds the Promise of the active batch so re-entrant flushNow() callers can
  // await it instead of returning before the RPC completes (F-reentrant-await).
  private _flushingPromise: Promise<void> | null = null;
  private _disposed = false;

  constructor(
    private readonly denops: Denops,
    private readonly bufnr: number,
    private readonly notebook: Notebook,
    private readonly caps: Capabilities,
    private readonly tickMs: number,
  ) {}

  /**
   * Add a message to the pending queue.
   *
   * Starts the 16 ms flush timer on the first enqueue. Messages arriving
   * while a flush is in flight are queued but do NOT join the in-flight
   * batch (Q-back-pressure). After the flush completes, a new timer is
   * started automatically if the queue is still non-empty.
   *
   * @spec-id europa.render.iopub-batch.queue-accumulate
   */
  enqueue(msg: KernelMessage, cellId: string): void {
    if (this._disposed) return; // Q-disposed: silent drop
    this.queue.push({ msg, cellId, arrivedAt: Date.now() });
    // Start timer only when no flush is in flight; if flushing, the finally
    // block of _runFlush will reschedule after the batch completes.
    if (this.timer === null && this._flushingPromise === null) {
      this.timer = setTimeout(() => {
        void this._doFlush();
      }, this.tickMs);
    }
  }

  /**
   * Drain the queue immediately without waiting for the next timer tick.
   *
   * If a batch is already in flight, awaits its completion first
   * (F-reentrant-await), then flushes any items that arrived during it.
   * The returned Promise resolves only after all pending output has been
   * sent to the viewer (or skipped due to hidden buffer).
   *
   * Used by the execute_reply trigger and the WS `onclose` handler
   * (Q-ws-close): callers await flushNow() so partial output is always
   * reflected before the execute loop sees AbortError.
   *
   * @spec-id europa.render.iopub-batch.empty-tick-skip
   * @spec-id europa.render.iopub-batch.reply-flush-immediate
   * @spec-id europa.render.iopub-batch.close-flush-sync
   */
  async flushNow(): Promise<void> {
    if (this._flushingPromise !== null) await this._flushingPromise;
    await this._doFlush();
  }

  /**
   * Final flush, timer cancellation, and shutdown.
   *
   * Idempotent: subsequent calls are no-ops. After dispose(), enqueue() calls
   * are silently dropped.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return; // D-idempotent
    this._disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this._flushingPromise !== null) await this._flushingPromise;
    await this._doFlush();
  }

  private _doFlush(): Promise<void> {
    // Timer callers are fire-and-forget; skip the tick if a batch is running.
    if (this._flushingPromise !== null) return Promise.resolve();

    // F-clear: cancel the pending timer before draining
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // F-empty: nothing to do when queue is empty — no RPC issued
    if (this.queue.length === 0) return Promise.resolve();

    // Assign synchronously before the first await so concurrent _doFlush()
    // calls see the in-flight promise immediately (JS single-thread guarantee).
    this._flushingPromise = this._runFlush();
    return this._flushingPromise;
  }

  private async _runFlush(): Promise<void> {
    // Snapshot the queue (Q-back-pressure: messages arriving during this flush
    // go to this.queue and are processed by the next tick, not the current batch)
    const entries = this.queue.splice(0);

    try {
      // F-hidden: skip the RPC when the viewer buffer is not visible
      const winid = await this.denops.call("bufwinid", this.bufnr);
      if (typeof winid !== "number" || winid === -1) {
        // Q-hidden-buffer: cell.outputs has already been updated by applyMessageToCell
        // in the execute loop, so skipping the RPC here does not lose data.
        return;
      }

      // F-affected: find the topmost affected cell for the partial render
      const cellIds = new Set(entries.map((e) => e.cellId));
      let fromCellId: string | undefined;
      for (const cell of this.notebook.cells) {
        if (cellIds.has(cell.id)) {
          fromCellId = cell.id;
          break;
        }
      }

      // F-batch: one RPC round-trip via batch() — side-effect only, no collect()
      await batch(this.denops, async (helper) => {
        await applyPartialRenderPlan(
          helper,
          this.bufnr,
          this.notebook,
          fromCellId,
          this.caps,
        );
      });
    } catch {
      // F-error: non-fatal — the execute loop must not die due to a render error
    } finally {
      this._flushingPromise = null;
      // Reschedule if new items were enqueued while this batch was in flight
      if (!this._disposed && this.queue.length > 0 && this.timer === null) {
        this.timer = setTimeout(() => {
          void this._doFlush();
        }, this.tickMs);
      }
    }
  }
}

/**
 * Create a new `IopubBatchScheduler` bound to a viewer buffer and notebook.
 *
 * Must be called after `client.start()` returns so that `bufnr`, `notebook`,
 * and `caps` are known. Lives for the full session lifetime
 * (`:EuropaStartKernel` → `:EuropaShutdownKernel` / `VimLeavePre`).
 *
 * @spec-id europa.render.iopub-batch.tick-scheduling
 * @spec-id europa.session.hidden-buffer.rpc-skip-during-hidden
 */
export function createIopubBatchScheduler(deps: {
  denops: Denops;
  bufnr: number;
  notebook: Notebook;
  caps: Capabilities;
  tickMs?: number;
}): IopubBatchScheduler {
  return new IopubBatchSchedulerImpl(
    deps.denops,
    deps.bufnr,
    deps.notebook,
    deps.caps,
    deps.tickMs ?? DEFAULT_TICK_MS,
  );
}
