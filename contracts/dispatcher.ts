/**
 * Behavioral contract for the Europa RPC dispatcher.
 *
 * `EuropaDispatcher` is a hand-written type (whitelist exception to Constitution I)
 * because RPC arguments must be `unknown` for TypeBox runtime validation, which
 * cannot be expressed as a TypeBox schema. See DESIGN.md §3.7.1.
 *
 * Phase 2 implements: init / open / save / previewOutput.
 * Phase 3+ methods are declared here so the type is stable across phases.
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
  open(path: unknown): Promise<void>;
  save(bufnr: unknown): Promise<void>;
  previewOutput(
    bufnr: unknown,
    cellIdx: unknown,
    outputIdx: unknown,
  ): Promise<void>;

  // Phase 3: editing methods (declared; implementation throws UnimplementedError)
  insertCell(bufnr: unknown, type: unknown, position: unknown): Promise<void>;
  deleteCell(bufnr: unknown, cellId: unknown): Promise<void>;
  moveCell(
    bufnr: unknown,
    cellId: unknown,
    direction: unknown,
  ): Promise<void>;
  splitCell(bufnr: unknown, cellId: unknown, line: unknown): Promise<void>;
  joinCell(bufnr: unknown, cellId: unknown): Promise<void>;
  editCell(bufnr: unknown, cellId: unknown): Promise<void>;
  runCell(bufnr: unknown, cellId: unknown): Promise<void>;
  runAll(bufnr: unknown): Promise<void>;
  startKernel(bufnr: unknown, name: unknown): Promise<void>;
  restartKernel(bufnr: unknown): Promise<void>;
  interruptKernel(bufnr: unknown): Promise<void>;

  // Phase 4: ZMQ attach
  attachKernel(connectionFile: unknown): Promise<void>;
};
