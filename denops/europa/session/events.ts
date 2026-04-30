/**
 * Autocmd registration for Europa session lifecycle.
 *
 * Wires `BufReadCmd`, `BufWriteCmd`, and `BufUnload` for `*.ipynb` files
 * into the `europa_ipynb` autocmd group so that opening, saving, and
 * closing a notebook buffer notifies the Denops plugin.
 *
 * @category Session
 */

import type { Denops } from "@denops/std";

/**
 * Register Europa autocmds into the `europa_ipynb` group.
 *
 * @param host - Denops instance for issuing Vim commands.
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 */
export async function setupAutocmds(host: Denops): Promise<void> {
  await host.cmd("augroup europa_ipynb");
  await host.cmd("autocmd!");
  await host.cmd(
    "autocmd BufReadCmd *.ipynb call denops#notify('europa', 'open', [expand('<afile>')])",
  );
  await host.cmd(
    "autocmd BufWriteCmd *.ipynb call denops#notify('europa', 'save', [expand('<afile>')])",
  );
  await host.cmd(
    "autocmd BufUnload *.ipynb call denops#notify('europa', 'close', [expand('<abuf>')])",
  );
  await host.cmd("augroup END");
}
