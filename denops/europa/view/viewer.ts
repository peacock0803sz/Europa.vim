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
 * Sets `modifiable=false` and `conceallevel=0` on the target buffer, then
 * writes the plan's lines. When a `viewport` is provided, only the visible
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
  await host.cmd("setlocal modifiable=false");
  await host.cmd("setlocal conceallevel=0");

  const lines = opts?.viewport
    ? plan.lines.slice(opts.viewport.topLine, opts.viewport.bottomLine + 1)
    : plan.lines;

  if (lines.length > 0) {
    await host.call("setline", 1, lines);
  }
}
