import { detectCapabilities } from "../../capabilities.ts";
import { loadConfig } from "../../config.ts";
import { buildRenderPlan } from "../../render/builder.ts";
import {
  applyRenderPlan,
  lineToCellId,
  restoreCursor,
} from "../../view/viewer.ts";
import type { SessionRuntime } from "../../session/state.ts";
import type { Notebook } from "../../../../schema/notebook.ts";
import type { CellRange, RenderPlan } from "../../../../schema/render-plan.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
  vimSingleQuote,
} from "../context.ts";
import { scheduleHighlightRefresh } from "../syntax-highlight.ts";
import { buildMirror } from "../../lsp/mirror.ts";
import { materializeMirror } from "../../lsp/workspace.ts";

export type MutationResult = {
  notebook: Notebook;
  plan: RenderPlan;
  preCellId: string | null;
  preCellRanges: CellRange[];
  winid: number;
};

type CellMutation = {
  notebook: Notebook;
  preferCellId?: string | null;
};

type OperateCellOptions = {
  bufnr: number;
  opName: string;
  session: SessionRuntime;
  mutate: (session: SessionRuntime) => Promise<CellMutation> | CellMutation;
};

export async function operateCell(
  ctx: DispatcherContext,
  options: OperateCellOptions,
): Promise<MutationResult | null> {
  const { denops, sessionStore } = ctx;
  const { bufnr, opName, session } = options;

  // Q-structural-conflict: drain iopub batch before line buffer mutates.
  await session.kernelRuntime?.iopubBatchScheduler?.flushNow();

  const prePlan = sessionStore.getRenderPlan(bufnr);
  const preCellRanges = prePlan?.cellRanges ?? [];
  const winid = await denops.call("bufwinid", bufnr) as number;
  const cursorPos = winid > 0
    ? await denops.call("getcurpos", winid) as number[]
    : [0, 1, 0, 0, 0];
  const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);

  const mutation = await options.mutate(session);
  const config = await loadConfig(denops);
  const caps = await detectCapabilities(denops);
  const plan = await buildRenderPlan(
    mutation.notebook,
    caps,
    renderPlanOpts(config),
  );
  sessionStore.update(bufnr, {
    notebook: mutation.notebook,
    cellMap: plan.cellMap,
  });
  sessionStore.setRenderPlan(bufnr, plan);
  if (session.lspMirror) {
    // Structural cell op changed the notebook → regenerate the mirror so the
    // line maps reflect the new cell order/set (FR-011 / research §8).
    const rebuilt = buildMirror(mutation.notebook);
    await materializeMirror(session.lspMirror.mirrorPath, rebuilt.text);
    sessionStore.update(bufnr, {
      lspMirror: {
        ...session.lspMirror,
        cellRegions: [...rebuilt.cellRegions],
        lineProvenance: [...rebuilt.lineProvenance],
      },
    });
  }
  try {
    await applyRenderPlan(denops, bufnr, plan);
    scheduleHighlightRefresh(ctx, bufnr); // FR-007: follow cell mutation
    await denops.call("setbufvar", bufnr, "&modified", 1);
  } catch {
    await echomError(denops, `${opName}: applyRenderPlan failed`);
  }
  await restoreCursor(
    denops,
    winid,
    preCellId,
    preCellRanges,
    plan.cellRanges,
    mutation.preferCellId ? { preferCellId: mutation.preferCellId } : undefined,
  );

  return {
    notebook: mutation.notebook,
    plan,
    preCellId,
    preCellRanges,
    winid,
  };
}

export async function refuseIfScratchDirty(
  ctx: DispatcherContext,
  viewerBufnr: number,
  cellId: string,
): Promise<boolean> {
  const { denops, sessionStore } = ctx;
  const sbn = sessionStore.getScratchBufnr(viewerBufnr, cellId);
  if (sbn === undefined) return false;
  const exists = await denops.call("bufexists", sbn);
  if (!exists) return false;
  const modified = await denops.call("getbufvar", sbn, "&modified");
  if (modified !== 1 && modified !== "1") return false;
  await denops.cmd(
    `echohl WarningMsg | echom ${
      vimSingleQuote(
        `Europa: cell ${cellId} has unsaved scratch edits - :write or :bdelete __europa_cell_${cellId}__ first`,
      )
    } | echohl None`,
  );
  return true;
}
