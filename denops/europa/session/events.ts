/**
 * Autocmd registration for Europa session lifecycle.
 *
 * Wires `BufReadCmd`, `BufWriteCmd`, `BufUnload`, and `BufWipeout` for
 * `*.ipynb` files into the `europa_ipynb` autocmd group so that opening,
 * saving, and closing a notebook buffer notifies the Denops plugin.
 *
 * `BufUnload` fires on `:bdelete` and covers the common close path.
 * `BufWipeout` (also `*.ipynb`) catches the viewer buffer being
 * force-wiped via `:bwipeout`, which `BufUnload` does not fire for.
 * Both autocmds dispatch `cleanup`, which then wipes any scratch edit
 * buffers attached to the viewer; scratch buffers themselves do not
 * match `*.ipynb` and therefore do not trigger this autocmd directly.
 *
 * @category Session
 */

import type { Denops } from "@denops/std";

/**
 * Register Europa autocmds into the `europa_ipynb` group.
 *
 * Both `BufUnload` and `BufWipeout` are registered for `*.ipynb` so that
 * the `cleanup` dispatcher is called on all exit paths.
 *
 * @param host - Denops instance for issuing Vim commands.
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 * @spec-id europa.session.events.bufunload-cleanup
 * @spec-id europa.session.events.bufwipeout-cleanup
 */
export async function setupAutocmds(host: Denops): Promise<void> {
  await host.cmd("augroup europa_ipynb");
  await host.cmd("autocmd!");
  await host.cmd(
    "autocmd BufReadCmd *.ipynb setfiletype europa | call europa#open(str2nr(expand('<abuf>')), expand('<afile>'))",
  );
  await host.cmd(
    "autocmd BufWriteCmd *.ipynb call europa#save()",
  );
  await host.cmd(
    "autocmd BufUnload *.ipynb call europa#cleanup(str2nr(expand('<abuf>')))",
  );
  await host.cmd(
    "autocmd BufWipeout *.ipynb call europa#cleanup(str2nr(expand('<abuf>')))",
  );
  await host.cmd("augroup END");
}
