/**
 * Autocmd registration for Europa session lifecycle.
 *
 * Phase 2 stub — wires `BufReadCmd *.ipynb` and `BufUnload *.ipynb`
 * into the `europa_ipynb` autocmd group. Full implementation lands
 * in US1 (T058) when the dispatcher's `open` method is wired.
 *
 * @category Session
 */

import type { Denops } from "@denops/std";

/**
 * Register Europa autocmds into the `europa_ipynb` group.
 *
 * Phase 2 skeleton: group creation only. `BufReadCmd` and `BufUnload`
 * handlers are added in US1 (T058) once the dispatcher is fully wired.
 *
 * @param denops - Denops instance for issuing Vim commands.
 */
export async function setupAutocmds(denops: Denops): Promise<void> {
  await denops.cmd("augroup europa_ipynb | augroup END");
}
