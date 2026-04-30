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
 * Writes the plan's lines into the target buffer using `setbufline`, then
 * locks the buffer (`&modifiable=0`), marks it `nomodified` (so `:q` does
 * not warn about pending changes), sets `&buftype=acwrite` (writes go
 * through the `BufWriteCmd` autocmd registered in `session/events.ts`),
 * and `setlocal conceallevel=0` via `win_execute` on the buffer's window
 * (conceallevel is window-local, so `setbufvar` cannot reach it). When a
 * `viewport` is provided, only the visible range is rendered (lazy
 * rendering for large notebooks).
 *
 * Uses buffer-targeted APIs (`setbufline`, `setbufvar`) so the render
 * lands on the correct buffer even when this runs after the user has
 * switched buffers — `denops#notify` is asynchronous relative to
 * `BufReadCmd`.
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
  bufnr: number,
  plan: RenderPlan,
  opts?: { viewport?: { topLine: number; bottomLine: number } },
): Promise<void> {
  await host.call("setbufvar", bufnr, "&modifiable", 1);

  try {
    const topOffset = opts?.viewport ? opts.viewport.topLine : 0;
    const lines = opts?.viewport
      ? plan.lines.slice(opts.viewport.topLine, opts.viewport.bottomLine + 1)
      : plan.lines;

    if (lines.length > 0) {
      await host.call("setbufline", bufnr, topOffset + 1, lines);
    }

    await host.call("deletebufline", bufnr, plan.lines.length + 1, "$");

    await host.call("setbufvar", bufnr, "&buftype", "acwrite");

    const winid = await host.call("bufwinid", bufnr);
    if (typeof winid === "number" && winid !== -1) {
      await host.call("win_execute", winid, "setlocal conceallevel=0");
    }
  } finally {
    await host.call("setbufvar", bufnr, "&modified", 0);
    await host.call("setbufvar", bufnr, "&modifiable", 0);
  }
}
