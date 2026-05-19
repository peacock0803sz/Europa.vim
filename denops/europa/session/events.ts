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
 * the `cleanup` dispatcher is called on all exit paths. `VimLeavePre` is
 * also registered to call `atexit` so that all kernels are shut down when
 * the user quits Vim (FR-022, SC-005).
 *
 * @param host - Denops instance for issuing Vim commands.
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 * @spec-id europa.session.events.bufunload-cleanup
 * @spec-id europa.session.events.bufwipeout-cleanup
 * @spec-id europa.session.events.vimleavepre-cleanup
 * @spec-id europa.session.events.md-overlay-scroll
 * @spec-id europa.session.events.md-overlay-wipeout
 */
export async function setupAutocmds(host: Denops): Promise<void> {
  await host.cmd("augroup europa_ipynb");
  await host.cmd("autocmd!");
  await host.cmd(
    "autocmd BufReadCmd *.ipynb setfiletype europa" +
      " | call europa#open(str2nr(expand('<abuf>')), expand('<afile>'))" +
      " | if get(g:, 'europa_auto_start_kernel', v:false)" +
      " | call timer_start(0, function('europa#start_kernel', [get(g:, 'europa_default_kernel', 'python3'), str2nr(expand('<abuf>'))]))" +
      " | endif",
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
  await host.cmd(
    "autocmd WinScrolled *.ipynb call denops#notify('europa', 'onMdOverlayScroll', [bufnr('%')])",
  );
  await host.cmd(
    "autocmd BufWipeout *.ipynb call denops#notify('europa', 'onMdOverlayWipeout', [bufnr('%')])",
  );
  await host.cmd(
    "autocmd VimLeavePre * call denops#notify('europa', 'atexit', [])",
  );
  // Q-hidden-buffer: detect when the viewer buffer becomes visible again so
  // the scheduler-driven in-memory cell.outputs can be flushed to the screen.
  await host.cmd(
    "autocmd BufWinEnter *.ipynb call denops#notify('europa', 'onBufWinEnter', [bufnr('%')])",
  );
  await host.cmd("augroup END");
}
