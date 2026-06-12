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
  openCellRegion,
  resolveLspEnabled,
  resolveScratchFiletype,
  syncMirrorBuffer,
} from "../../view/viewer.ts";
import { buildMirror } from "../../lsp/mirror.ts";
import { distributeWriteBack } from "../../lsp/writeback.ts";
import {
  cleanupMirrorFile,
  materializeMirror,
  resolveMirrorPlacement,
} from "../../lsp/workspace.ts";
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
      const config = await loadConfig(denops);
      if (resolveLspEnabled(config.lsp_enable, session.notebook, cell)) {
        // LSP path: edit the single on-disk notebook mirror (FR-001 / FR-005a).
        let mirror = session.lspMirror;
        if (!mirror) {
          const placement = await resolveMirrorPlacement(
            session.notebookPath || undefined,
          );
          const build = buildMirror(session.notebook);
          await materializeMirror(placement.mirrorPath, build.text);
          mirror = {
            mirrorPath: placement.mirrorPath,
            workspaceRoot: placement.workspaceRoot,
            mirrorDir: placement.mirrorDir,
            cellRegions: [...build.cellRegions],
            lineProvenance: [...build.lineProvenance],
          };
          sessionStore.update(bn, { lspMirror: mirror });
        }
        const open = await denops.call("bufnr", mirror.mirrorPath) as number;
        const mirrorBufnr = await openCellRegion(denops, {
          mirrorPath: mirror.mirrorPath,
          viewerBufnr: bn,
          cellRegions: mirror.cellRegions,
          cellId: cid,
          existingMirrorBufnr: open > 0 ? open : undefined,
        });
        sessionStore.update(bn, { lspMirror: { ...mirror, mirrorBufnr } });
        sessionStore.setCellEditBuffer(bn, cid, mirrorBufnr);
        return;
      }
      // 004 fallback: per-cell acwrite scratch buffer (FR-004).
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

      const mirror = session.lspMirror;
      // The mirror and a 004 scratch can coexist (the toggle is re-read per
      // editCell), so route through the marker-based distributor only when the
      // SAVING buffer is the mirror itself — a scratch's lines have no markers
      // and would otherwise be silently dropped.
      const isMirrorSave = mirror !== undefined && mirror.mirrorBufnr === sbn;
      let newNotebook = session.notebook;
      if (mirror && isMirrorSave) {
        // Mirror: distribute the whole buffer back to every cell by re-scanning
        // the live `# %% <cellId>` markers (FR-013); one save = one undo entry.
        const perCell = distributeWriteBack(lines, mirror);
        session.undoHistory.push({
          opType: "saveCellEdit",
          snapshot: takeStructuralSnapshot(session.notebook),
          beforeHint: { kind: "single", cellId: lookup.cellId },
          afterHint: { kind: "single", cellId: lookup.cellId },
        });
        for (const { cellId, source } of perCell) {
          newNotebook = updateCellSource(newNotebook, cellId, source);
        }
      } else {
        // 004 scratch: single-cell write-back (unchanged).
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
        newNotebook = updateCellSource(
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
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = await buildRenderPlan(
        newNotebook,
        caps,
        renderPlanOpts(config),
      );
      sessionStore.update(lookup.viewerBufnr, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(lookup.viewerBufnr, plan);
      if (mirror) {
        // Regenerate the mirror state + on-disk file from the updated notebook
        // so the line maps stay consistent for the next save (research §8).
        const rebuilt = buildMirror(newNotebook);
        await materializeMirror(mirror.mirrorPath, rebuilt.text);
        sessionStore.update(lookup.viewerBufnr, {
          lspMirror: {
            ...mirror,
            cellRegions: [...rebuilt.cellRegions],
            lineProvenance: [...rebuilt.lineProvenance],
          },
        });
        if (mirror.mirrorBufnr !== undefined) {
          // Keep the open buffer in step with the regenerated mirror. For the
          // mirror's own :w the content was just absorbed, so force-replace it
          // with the re-normalized text; for a scratch-originated save the
          // buffer may hold unsaved edits and is only synced when clean.
          await syncMirrorBuffer(
            denops,
            mirror.mirrorBufnr,
            rebuilt.text.split("\n"),
            { force: isMirrorSave },
          );
        }
      }
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
      const session = sessionStore.get(lookup.viewerBufnr);
      sessionStore.removeCellEditBuffer(lookup.viewerBufnr, lookup.cellId);
      await closeCellEditAutocmds(denops, sbn);
      // Only when the wiped buffer IS the shared mirror: remove the on-disk
      // file and drop the state so a later edit re-materializes (FR-018). A
      // coexisting 004 scratch wipeout must leave the mirror untouched.
      if (session?.lspMirror?.mirrorBufnr === sbn) {
        await cleanupMirrorFile(session.lspMirror.mirrorPath);
        sessionStore.update(lookup.viewerBufnr, { lspMirror: undefined });
      }
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
