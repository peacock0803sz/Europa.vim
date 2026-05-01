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
 * Phase 3+ remaining methods are declared here so the type is stable across phases.
 *
 * @module contracts/dispatcher
 */

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

  // Phase 3 remaining / Phase 4 (throw UnimplementedError)
  runCell(bufnr: unknown, cellId: unknown): Promise<void>;
  runAll(bufnr: unknown): Promise<void>;
  startKernel(bufnr: unknown, name: unknown): Promise<void>;
  restartKernel(bufnr: unknown): Promise<void>;
  interruptKernel(bufnr: unknown): Promise<void>;

  // Phase 4: ZMQ attach
  attachKernel(connectionFile: unknown): Promise<void>;
};
