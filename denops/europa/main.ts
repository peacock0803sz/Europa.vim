/**
 * @packageDocumentation
 *
 * Europa.vim — Jupyter Notebook viewer for Vim and Neovim.
 *
 * Entry point registered with the Denops runtime. The `main` function wires
 * the Europa RPC dispatcher and is called once when the plugin loads.
 *
 * ## Quick Start
 *
 * Open any `.ipynb` file with `:edit foo.ipynb`. Europa intercepts the read
 * via `BufReadCmd`, parses the notebook, and renders each cell with highlight
 * group decorations. Use `:EuropaPreviewOutput <cellIdx> <outputIdx>` to open
 * image outputs in an external viewer.
 *
 * ## Phase Coverage
 *
 * - Phase 2 (this release): `init`, `open` (stub), `save` (stub), `previewOutput` (stub)
 * - Phase 3+: cell editing, kernel attach — methods declared but throw `UnimplementedError`
 *
 * @module denops/europa/main
 */

import type { Denops } from "@denops/std";
import type { EuropaDispatcher } from "../../contracts/dispatcher.ts";
import { defineHighlights } from "./view/highlight.ts";
import { loadConfig } from "./config.ts";
import { detectCapabilities } from "./capabilities.ts";
import { setupAutocmds } from "./session/events.ts";

/** Thrown by Phase 3+ dispatcher methods that are not yet implemented. */
export class UnimplementedError extends Error {
  constructor(method: string) {
    super(`UnimplementedError: ${method} is not implemented in Phase 2`);
    this.name = "UnimplementedError";
  }
}

/**
 * Build the Europa RPC dispatcher record.
 *
 * Returns an object whose shape satisfies `EuropaDispatcher`. The factory is
 * separate from `main` so tests can import and verify the dispatcher shape
 * without a live Vim process.
 *
 * @param denops - Denops instance for issuing Vim commands.
 * @returns Dispatcher record registered as `denops.dispatcher`.
 * @spec-id europa.contract.dispatcher-alignment
 */
export function buildDispatcher(denops: Denops): EuropaDispatcher {
  return {
    // Phase 2: init — wires highlights, config, capabilities, autocmds
    async init(): Promise<void> {
      await defineHighlights(denops);
      await loadConfig(denops);
      await detectCapabilities(denops);
      await setupAutocmds(denops);
    },

    // Phase 2: open — full implementation in US1 (T059)
    open(_path: unknown): Promise<void> {
      return Promise.resolve();
    },

    // Phase 2: save — full implementation in US4 (T098)
    save(_bufnr: unknown): Promise<void> {
      return Promise.resolve();
    },

    // Phase 2: previewOutput — full implementation in US3 (T089)
    previewOutput(
      _bufnr: unknown,
      _cellIdx: unknown,
      _outputIdx: unknown,
    ): Promise<void> {
      return Promise.resolve();
    },

    // Phase 3+: editing methods — not yet implemented
    insertCell(
      _bufnr: unknown,
      _type: unknown,
      _position: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("insertCell"));
    },
    deleteCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("deleteCell"));
    },
    moveCell(
      _bufnr: unknown,
      _cellId: unknown,
      _direction: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("moveCell"));
    },
    splitCell(
      _bufnr: unknown,
      _cellId: unknown,
      _line: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("splitCell"));
    },
    joinCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("joinCell"));
    },
    editCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("editCell"));
    },
    runCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("runCell"));
    },
    runAll(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("runAll"));
    },
    startKernel(_bufnr: unknown, _name: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("startKernel"));
    },
    restartKernel(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("restartKernel"));
    },
    interruptKernel(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("interruptKernel"));
    },

    // Phase 4: ZMQ attach
    attachKernel(_connectionFile: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("attachKernel"));
    },
  };
}

/**
 * Denops plugin entry point.
 *
 * Called once by the Denops runtime when the plugin loads. Registers the
 * Europa dispatcher so Vim can call `denops#notify('europa', 'init', [])`.
 *
 * @param denops - Denops instance provided by the runtime.
 */
export function main(denops: Denops): Promise<void> {
  denops.dispatcher = buildDispatcher(denops);
  return Promise.resolve();
}
