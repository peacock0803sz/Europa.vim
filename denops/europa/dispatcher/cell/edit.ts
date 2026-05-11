import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { detectCapabilities } from "../../capabilities.ts";
import { loadConfig } from "../../config.ts";
import { updateCellSource } from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import { buildRenderPlan } from "../../render/builder.ts";
import {
  applyRenderPlan,
  closeCellEditAutocmds,
  lineToCellId as resolveLineToCellId,
  openCellEditBuffer,
  resolveScratchFiletype,
} from "../../view/viewer.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "../context.ts";
import { scheduleHighlightRefresh } from "../syntax-highlight.ts";

export function buildEditCellDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  "editCell" | "saveCellEdit" | "closeCellEdit" | "lineToCellId"
> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Open (or focus) a scratch buffer to edit a single cell's source.
     *
     * @spec-id europa.dispatcher.edit-cell
     */
    async editCell(bufnr: unknown, cellId: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `editCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const cell = session.notebook.cells.find((c) => c.id === cid);
      if (!cell) {
        await echomError(denops, `editCell: cell '${cid}' not found`);
        return;
      }
      const filetype = resolveScratchFiletype(session.notebook, cell);
      const sourceLines = cell.source.split("\n");
      const existing = sessionStore.getScratchBufnr(bn, cid);
      const scratchBufnr = await openCellEditBuffer(denops, {
        bufname: `__europa_cell_${cid}__`,
        cellId: cid,
        viewerBufnr: bn,
        sourceLines,
        filetype,
        existingScratchBufnr: existing,
      });
      sessionStore.setCellEditBuffer(bn, cid, scratchBufnr);
    },
    /**
     * Commit a scratch buffer's contents back into the in-memory notebook.
     *
     * @spec-id europa.dispatcher.save-cell-edit
     */
    async saveCellEdit(scratchBufnr: unknown): Promise<void> {
      const sbn = Number(scratchBufnr);
      const lookup = sessionStore.findViewerByScratchBufnr(sbn);
      if (!lookup) return;
      const session = sessionStore.get(lookup.viewerBufnr);
      if (!session) return;
      await session.kernelRuntime?.iopubBatchScheduler?.flushNow();
      const lines = await denops.call(
        "getbufline",
        sbn,
        1,
        "$",
      ) as string[];
      const newSource = lines.join("\n");
      const cellIdx = session.notebook.cells.findIndex(
        (c) => c.id === lookup.cellId,
      );
      if (cellIdx >= 0) {
        session.undoHistory.push({
          opType: "saveCellEdit",
          snapshot: takeStructuralSnapshot(session.notebook),
          beforeHint: { kind: "single", cellId: lookup.cellId },
          afterHint: { kind: "single", cellId: lookup.cellId },
          scratchSync: {
            cellId: lookup.cellId,
            preSource: session.notebook.cells[cellIdx].source,
          },
        });
      }
      const newNotebook = updateCellSource(
        session.notebook,
        lookup.cellId,
        newSource,
      );
      if (Object.is(newNotebook, session.notebook)) {
        await echomError(
          denops,
          `saveCellEdit: cell '${lookup.cellId}' is no longer in the notebook; edit was not applied`,
        );
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(lookup.viewerBufnr, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(lookup.viewerBufnr, plan);
      try {
        await applyRenderPlan(denops, lookup.viewerBufnr, plan);
        scheduleHighlightRefresh(ctx, lookup.viewerBufnr); // FR-007: text-edit follow-up
        await denops.call(
          "setbufvar",
          lookup.viewerBufnr,
          "&modified",
          1,
        );
      } catch {
        await echomError(denops, "saveCellEdit: applyRenderPlan failed");
      }
      await denops.call("setbufvar", sbn, "&modified", 0);
    },
    /**
     * Tear down session state for a wiped scratch buffer.
     *
     * @spec-id europa.dispatcher.close-cell-edit
     */
    async closeCellEdit(scratchBufnr: unknown): Promise<void> {
      const sbn = Number(scratchBufnr);
      const lookup = sessionStore.findViewerByScratchBufnr(sbn);
      if (!lookup) return;
      sessionStore.removeCellEditBuffer(lookup.viewerBufnr, lookup.cellId);
      await closeCellEditAutocmds(denops, sbn);
    },
    /**
     * Resolve a 1-origin viewer buffer line number to the cell id containing it.
     *
     * @spec-id europa.dispatcher.line-to-cellid
     */
    lineToCellId(
      bufnr: unknown,
      line: unknown,
    ): Promise<string | null> {
      const bn = Number(bufnr);
      const ln = Number(line);
      const plan = sessionStore.getRenderPlan(bn);
      if (!plan) return Promise.resolve(null);
      return Promise.resolve(resolveLineToCellId(plan.cellRanges, ln));
    },
  };
}
