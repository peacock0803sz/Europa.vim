/**
 * @packageDocumentation
 *
 * Europa.vim - Jupyter Notebook viewer and editor for Vim and Neovim.
 *
 * Entry point registered with the Denops runtime. The `main` function wires
 * the Europa RPC dispatcher and is called once when the plugin loads.
 *
 * @category Commands
 * @category Mappings
 * @module denops/europa/main
 */

import type { Denops } from "@denops/std";
import type { EuropaDispatcher } from "../../contracts/dispatcher.ts";
import { buildCellDispatcher } from "./dispatcher/cell/index.ts";
import type { DispatcherContext } from "./dispatcher/context.ts";
import { buildExecDispatcher } from "./dispatcher/exec/index.ts";
import { buildKernelDispatcher } from "./dispatcher/kernel.ts";
import { buildNotebookDispatcher } from "./dispatcher/notebook.ts";
import { buildSyntaxHighlightDispatcher } from "./dispatcher/syntax-highlight.ts";
import { buildUndoDispatcher } from "./dispatcher/undo.ts";
import { buildViewDispatcher } from "./dispatcher/view.ts";
import { ServerPool } from "./kernel/server-pool.ts";
import { setBinaryMissingHandler } from "./render/svg-converter.ts";
import { SessionStore } from "./session/state.ts";

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
 * @spec-id europa.dispatcher.preview-output
 * @spec-id europa.commands.preview-output
 * @spec-id europa.contract.dispatcher-phase3-1-alignment
 * @spec-id europa.contract.dispatcher-phase3-2-alignment
 */
export function buildDispatcher(denops: Denops): EuropaDispatcher {
  const ctx: DispatcherContext = {
    denops,
    sessionStore: new SessionStore(),
    serverPool: new ServerPool(),
  };

  return {
    ...buildNotebookDispatcher(ctx),
    ...buildCellDispatcher(ctx),
    ...buildKernelDispatcher(ctx),
    ...buildExecDispatcher(ctx),
    ...buildViewDispatcher(ctx),
    ...buildUndoDispatcher(ctx),
    ...buildSyntaxHighlightDispatcher(ctx),
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
  // Register the binary-missing handler so that when rsvg-convert is not
  // found, a single session-level warning is emitted via Vim's :messages
  // (FR-020 / FR-021). The handler fires at most once per process.
  setBinaryMissingHandler(() => {
    denops.cmd(
      "echohl WarningMsg | echom 'Europa: rsvg-convert not found; SVG outputs render as XML source. Install librsvg for inline PNG rendering.' | echohl None",
    ).catch(() => {});
  });
  denops.dispatcher = buildDispatcher(denops);
  return Promise.resolve();
}
