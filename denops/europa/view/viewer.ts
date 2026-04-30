/**
 * Viewer: applies a RenderPlan to a Vim/Neovim buffer.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import type { RenderPlan } from "../../../schema/render-plan.ts";

/**
 * Apply a `RenderPlan` to a buffer.
 *
 * Writes the plan's lines while modifiable, then locks the buffer with
 * `nomodifiable`, marks it `nomodified` (so `:q` does not warn about
 * pending changes), sets `buftype=acwrite` (writes go through the
 * `BufWriteCmd` autocmd registered in `session/events.ts`), and
 * `conceallevel=0`. When a `viewport` is provided, only the visible
 * range is rendered (lazy rendering for large notebooks).
 *
 * @param host - Active Denops instance.
 * @param bufnr - Target buffer number.
 * @param plan - RenderPlan produced by `buildRenderPlan`.
 * @param opts - Optional rendering configuration.
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 */
export async function applyRenderPlan(
  host: Denops,
  _bufnr: number,
  plan: RenderPlan,
  opts?: { viewport?: { topLine: number; bottomLine: number } },
): Promise<void> {
  await host.cmd("setlocal modifiable");

  const lines = opts?.viewport
    ? plan.lines.slice(opts.viewport.topLine, opts.viewport.bottomLine + 1)
    : plan.lines;

  if (lines.length > 0) {
    await host.call("setline", 1, lines);
  }

  await host.cmd("setlocal buftype=acwrite");
  await host.cmd("setlocal nomodified");
  await host.cmd("setlocal nomodifiable");
  await host.cmd("setlocal conceallevel=0");
}
