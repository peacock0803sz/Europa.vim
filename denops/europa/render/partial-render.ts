/**
 * High-level helper for partial RenderPlan application.
 *
 * Calls `buildRenderPlan` for the full notebook, then applies only the
 * cells from `fromCellId` onwards via `applyRenderPlan({ fromCellId })`.
 * When `fromCellId` is undefined or not found in the plan, falls back to
 * the full render path.
 *
 * Used by `IopubBatchScheduler.flushNow()` to minimise RPC calls during
 * streaming execution while preserving text-property / extmark IDs for
 * cells above the first affected cell (SC-003).
 *
 * @module denops/europa/render/partial-render
 * @category Render
 */

import type { Denops } from "@denops/std";
import type { Notebook } from "../../../schema/notebook.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { MagickConverter } from "../view/viewer.ts";
import { buildRenderPlan } from "./builder.ts";
import type { BuildRenderPlanOpts } from "../../../schema/render-plan.ts";
import { applyRenderPlan } from "../view/viewer.ts";

/**
 * Apply a partial render starting from `fromCellId`.
 *
 * Calls `buildRenderPlan(notebook, caps, renderOpts)` then delegates to
 * `applyRenderPlan` with the `fromCellId` option set.
 *
 * @param denops      - Denops (or batch helper) for RPC.
 * @param bufnr       - Viewer buffer number.
 * @param notebook    - Live notebook reference. Reads `cell.outputs` as
 *   updated by `applyMessageToCell` in the execute loop.
 * @param fromCellId  - Topmost cell that should be re-rendered. Pass
 *   `undefined` for a full render (identical to calling `applyRenderPlan`
 *   directly without `fromCellId`).
 * @param caps        - Host capabilities captured at scheduler creation.
 * @param opts        - Optional render opts (borders, maxOutputLines) and
 *   `_magickConverter` for test injection. When omitted, builder defaults
 *   apply (same as the streaming path before this parameter was added).
 *
 * @spec-id europa.render.partial.affected-cell-rerender
 */
export async function applyPartialRenderPlan(
  denops: Denops,
  bufnr: number,
  notebook: Notebook,
  fromCellId: string | undefined,
  caps: Capabilities,
  opts?: {
    renderOpts?: BuildRenderPlanOpts;
    _magickConverter?: MagickConverter;
  },
): Promise<void> {
  const plan = buildRenderPlan(notebook, caps, opts?.renderOpts);
  await applyRenderPlan(denops, bufnr, plan, {
    fromCellId,
    _magickConverter: opts?._magickConverter,
  });
}
