/**
 * Behavioral contract for the Europa RPC dispatcher.
 *
 * `EuropaDispatcher` is a hand-written type (whitelist exception to Constitution I)
 * because RPC arguments must be `unknown` for TypeBox runtime validation, which
 * cannot be expressed as a TypeBox schema. See DESIGN.md §3.7.1.
 *
 * Phase 2 implements: init / open / save / previewOutput / cleanup.
 * Phase 3.1 implements: insertCell / deleteCell, plus internal RPCs
 *   saveCellEdit / closeCellEdit / lineToCellId.
 * Phase 3.1 declares (stubbed with UnimplementedError until later phases):
 *   moveCell / splitCell / joinCell / editCell / changeCellType.
 * Phase 3.2 implements: startKernel / shutdownKernel / kernelStatus / atexit.
 * Phase 3+ remaining methods are declared here so the type is stable across phases.
 *
 * @module contracts/dispatcher
 * @spec-id europa.contract.dispatcher-phase3-2-alignment
 */

import type { KernelStatusReport } from "../schema/session.ts";

/**
 * RPC interface registered as `denops.dispatcher` in `main.ts`.
 *
 * All arguments are `unknown` — internal validation uses TypeBox Value.Check.
 */
export type EuropaDispatcher = {
  // Phase 2: viewer methods
  init(): Promise<void>;
  open(bufnr: unknown, path: unknown): Promise<void>;
  save(bufnr: unknown): Promise<void>;
  previewOutput(
    bufnr: unknown,
    cellIdx: unknown,
    outputIdx: unknown,
  ): Promise<void>;
  cleanup(bufnr: unknown): Promise<void>;

  // Phase 3.1: editing methods
  insertCell(
    bufnr: unknown,
    type: unknown,
    position: unknown,
    anchorCellId: unknown,
  ): Promise<void>;
  deleteCell(bufnr: unknown, cellId: unknown): Promise<void>;
  moveCell(bufnr: unknown, cellId: unknown, direction: unknown): Promise<void>;
  splitCell(bufnr: unknown, cellId: unknown, line: unknown): Promise<void>;
  joinCell(bufnr: unknown, cellId: unknown): Promise<void>;
  editCell(bufnr: unknown, cellId: unknown): Promise<void>;
  /**
   * Change the type of a cell between code / markdown / raw.
   * @spec-id europa.dispatcher.change-cell-type
   */
  changeCellType(
    bufnr: unknown,
    cellId: unknown,
    newType: unknown,
  ): Promise<void>;

  // Phase 3.1 internal RPCs (called from autocmd / autoload helper)
  /**
   * Persist scratch buffer content back to the Notebook.
   * Phase 3.1 internal RPC; called from the `BufWriteCmd` autocmd on scratch buffers.
   * @spec-id europa.dispatcher.save-cell-edit
   */
  saveCellEdit(scratchBufnr: unknown): Promise<void>;
  /**
   * Clean up a scratch buffer's autocmds and session bookkeeping.
   * Phase 3.1 internal RPC; called from the `BufWipeout` autocmd on scratch buffers.
   * @spec-id europa.dispatcher.close-cell-edit
   */
  closeCellEdit(scratchBufnr: unknown): Promise<void>;
  /**
   * Resolve a 1-origin viewer buffer line to the cell id that contains it.
   * Phase 3.1 internal RPC; called synchronously from `europa#current_cell_id()`
   * via `denops#request` to identify the cell at the cursor.
   * @spec-id europa.dispatcher.line-to-cellid
   */
  lineToCellId(bufnr: unknown, line: unknown): Promise<string | null>;

  // Phase 3.2: kernel lifecycle methods
  /**
   * Starts a kernel for the given viewer buffer.
   *
   * @param bufnr - viewer buffer number
   * @param kernelName - kernel spec name (default = g:europa_default_kernel)
   * @throws EuropaKernelError on handshake failure
   * @spec-id europa.dispatcher.start-kernel
   */
  startKernel(bufnr: unknown, kernelName?: unknown): Promise<void>;

  /**
   * Shuts down the kernel attached to the given viewer buffer.
   * Idempotent: no-op if no kernel is attached.
   *
   * @spec-id europa.dispatcher.shutdown-kernel
   */
  shutdownKernel(bufnr: unknown): Promise<void>;

  /**
   * Returns the current kernel status for the given viewer buffer.
   * Returns { info: null, wsState: 'NONE' } if no kernel is attached.
   *
   * @spec-id europa.dispatcher.kernel-status
   */
  kernelStatus(bufnr: unknown): Promise<KernelStatusReport>;

  /**
   * Shuts down all kernel connections and kills remaining server processes.
   * Called from VimLeavePre autocmd.
   *
   * @spec-id europa.dispatcher.atexit
   */
  atexit(): Promise<void>;

  /**
   * Execute the cell at the given cellId on the attached kernel.
   * Phase 3.3 dispatcher RPC (runCell). When execState is busy, the cell
   * is enqueued in pendingRequests (state='queued') without sending an
   * execute_request (FR-008 auto-dispatch disabled).
   * @spec-id europa.dispatcher.run-cell
   * @spec-id europa.dispatcher.run-cell-queued-on-busy
   */
  runCell(bufnr: unknown, cellId: unknown): Promise<void>;

  /**
   * Execute all code cells top-to-bottom, stopping on first error (Q2 default A).
   * Phase 3.3 dispatcher RPC (runAll).
   * @spec-id europa.dispatcher.run-all
   */
  runAll(bufnr: unknown): Promise<void>;

  /**
   * Send REST POST /api/kernels/{kid}/interrupt to the Jupyter server.
   * Phase 3.3 dispatcher RPC (interruptKernel).
   * @spec-id europa.dispatcher.interrupt-kernel
   */
  interruptKernel(bufnr: unknown): Promise<void>;

  /**
   * Send REST POST /api/kernels/{kid}/restart, then re-open WebSocket
   * and re-handshake via kernelInfo().
   * Phase 3.3 dispatcher RPC (restartKernel).
   * @spec-id europa.dispatcher.restart-kernel
   */
  restartKernel(bufnr: unknown): Promise<void>;

  /**
   * Drop the queued pendingRequests entry for the cell at cellId.
   * No-op (with info message) if the cell is in any state other than 'queued'.
   * No network message is sent regardless of outcome (Q-cancel design).
   * Phase 3.3 dispatcher RPC (cancelCell).
   * @spec-id europa.dispatcher.cancel-cell
   */
  cancelCell(bufnr: unknown, cellId: unknown): Promise<void>;

  // Phase 4: ZMQ attach
  attachKernel(connectionFile: unknown): Promise<void>;
};
