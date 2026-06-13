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
} from "../../view/viewer.ts";
import { buildMirror } from "../../lsp/mirror.ts";
import {
  distributeWriteBack,
  pickMirrorSaveHintCell,
} from "../../lsp/writeback.ts";
import {
  cleanupMirrorOnExit,
  materializeMirror,
  resolveMirrorPlacement,
} from "../../lsp/workspace.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "../context.ts";
import { scheduleHighlightRefresh } from "../syntax-highlight.ts";
import { refreshMirror } from "../_mirror.ts";
import type { SessionStore } from "../../session/state.ts";

/**
 * Resolve the viewer/cell a saving or wiped buffer belongs to. The cellId
 * registration can be overwritten when a cell is re-opened as a 004 scratch
 * (the lsp_enable toggle is re-read per editCell), which would orphan a
 * still-open mirror buffer — its :w silently no-ops and its wipeout leaks
 * the on-disk file. Fall back to the mirror bufnr tracked in session state.
 */
function resolveEditTarget(
  sessionStore: SessionStore,
  sbn: number,
): { viewerBufnr: number; cellId: string } | undefined {
  const lookup = sessionStore.findViewerByScratchBufnr(sbn);
  if (lookup) return lookup;
  for (const session of sessionStore.all()) {
    if (session.lspMirror?.mirrorBufnr === sbn) {
      // Any mirrored cell works as the nominal origin: the mirror save path
      // only uses it as the undo-hint fallback.
      const cellId = session.lspMirror.cellRegions[0]?.cellId;
      if (cellId !== undefined) {
        return { viewerBufnr: session.bufnr, cellId };
      }
    }
  }
  return undefined;
}

export function buildEditCellDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  | "editCell"
  | "saveCellEdit"
  | "closeCellEdit"
  | "mirrorReloaded"
  | "lineToCellId"
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
        if (mirror.bufferStale) {
          // The buffer kept unsaved edits across a notebook mutation: its
          // folds/cursor will misalign with the fresh regions and a :w will
          // be refused — surface that before the user starts editing.
          await denops.cmd(
            "echohl WarningMsg | echom 'Europa: the mirror buffer is out of sync with the notebook — :edit! it to resync' | echohl None",
          );
        }
        // Reuse the bufnr tracked in state — bufnr("<path>") treats the name
        // as a file-pattern (wildcards, substring matches) and can resolve to
        // an unrelated buffer. openCellRegion re-validates it via bufexists.
        const mirrorBufnr = await openCellRegion(denops, {
          mirrorPath: mirror.mirrorPath,
          viewerBufnr: bn,
          cellRegions: mirror.cellRegions,
          cellId: cid,
          existingMirrorBufnr: mirror.mirrorBufnr,
        });
        sessionStore.update(bn, { lspMirror: { ...mirror, mirrorBufnr } });
        sessionStore.setCellEditBuffer(bn, cid, mirrorBufnr);
        return;
      }
      // 004 fallback: per-cell acwrite scratch buffer (FR-004).
      const filetype = resolveScratchFiletype(session.notebook, cell);
      const sourceLines = cell.source.split("\n");
      // The registration under this cellId may point at the MIRROR buffer
      // (the toggle is re-read per editCell) — reusing it here would silently
      // ignore g:europa_lsp_enable=false for cells edited via the mirror.
      const registered = sessionStore.getScratchBufnr(bn, cid);
      const existing = registered === session.lspMirror?.mirrorBufnr
        ? undefined
        : registered;
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
      const lookup = resolveEditTarget(sessionStore, sbn);
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
      if (mirror && isMirrorSave && mirror.bufferStale) {
        // The notebook changed while this buffer held unsaved edits, so its
        // lines describe the OLD cell layout: distributing them against the
        // new regions would merge removed cells' content into neighbours.
        await echomError(
          denops,
          "saveCellEdit: the mirror buffer is out of sync with the notebook" +
            " — :edit! it to reload (this discards its unsaved edits)",
        );
        return;
      }
      let newNotebook = session.notebook;
      if (mirror && isMirrorSave) {
        // Mirror: distribute the whole buffer back to every cell by re-scanning
        // the live `# %% <cellId>` markers (FR-013); one save = one undo entry.
        const perCell = distributeWriteBack(lines, mirror);
        if (perCell.length === 0 && mirror.cellRegions.length > 0) {
          // Zero blocks from a non-empty build means every marker was
          // deleted/rewritten — NOT a clean no-op. Acknowledging the write
          // would silently ignore the whole buffer and let the next sync
          // replace it.
          await echomError(
            denops,
            "saveCellEdit: no cell markers left in the mirror buffer" +
              " — :edit! it to restore them (the buffer was not saved)",
          );
          return;
        }
        // The hint must name a cell that actually changed — the registered
        // origin cell may be untouched when e.g. a formatter edited others.
        // null = no cell changed: skip the undo entry so a no-op :w does not
        // consume an undo_max_history slot.
        const hintCellId = pickMirrorSaveHintCell(
          perCell,
          session.notebook.cells,
          lookup.cellId,
        );
        if (hintCellId === null) {
          // No cell changed: re-rendering and dirtying the viewer would
          // falsely mark the notebook modified — just acknowledge the write.
          await denops.call("setbufvar", sbn, "&modified", 0);
          return;
        }
        session.undoHistory.push({
          opType: "saveCellEdit",
          snapshot: takeStructuralSnapshot(session.notebook),
          beforeHint: { kind: "single", cellId: hintCellId },
          afterHint: { kind: "single", cellId: hintCellId },
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
      // Regenerate the mirror state + on-disk file from the updated notebook
      // so the line maps stay consistent for the next save (research §8). For
      // the mirror's own :w the buffer content was just absorbed, so it is
      // force-replaced with the re-normalized text; for a scratch-originated
      // save the buffer may hold unsaved edits and is only synced when clean.
      await refreshMirror(ctx, lookup.viewerBufnr, newNotebook, {
        forceBufferSync: isMirrorSave,
      });
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
      const lookup = resolveEditTarget(sessionStore, sbn);
      if (!lookup) return;
      const session = sessionStore.get(lookup.viewerBufnr);
      // The mirror is registered once per edited cell — remove EVERY entry
      // pointing at the wiped bufnr, or a later save against the dead bufnr
      // would still resolve and route through the 004 scratch path.
      for (
        const [cellId, bufnr] of sessionStore.getAllScratchBufnrs(
          lookup.viewerBufnr,
        )
      ) {
        if (bufnr === sbn) {
          sessionStore.removeCellEditBuffer(lookup.viewerBufnr, cellId);
        }
      }
      await closeCellEditAutocmds(denops, sbn);
      // Only when the wiped buffer IS the shared mirror: remove the on-disk
      // mirror and drop the state so a later edit re-materializes (FR-018). A
      // coexisting 004 scratch wipeout must leave the mirror untouched.
      // cleanupMirrorOnExit (not just the file) because dropping the state
      // makes this the last chance to remove an unsaved notebook's
      // per-session cache dir — atexit can no longer see it.
      if (session?.lspMirror?.mirrorBufnr === sbn) {
        await cleanupMirrorOnExit(session.lspMirror);
        sessionStore.update(lookup.viewerBufnr, { lspMirror: undefined });
      }
    },
    /**
     * Lift the stale-save guard after the mirror buffer is reloaded from
     * disk: the on-disk mirror is regenerated on every notebook mutation, so
     * a reload (`:edit!`, BufReadPost) brings the buffer back in sync with
     * the regions/provenance held in state.
     *
     * @spec-id europa.dispatcher.mirror-reloaded
     */
    mirrorReloaded(mirrorBufnr: unknown): Promise<void> {
      const sbn = Number(mirrorBufnr);
      const lookup = resolveEditTarget(sessionStore, sbn);
      if (!lookup) return Promise.resolve();
      const mirror = sessionStore.get(lookup.viewerBufnr)?.lspMirror;
      if (mirror?.mirrorBufnr === sbn && mirror.bufferStale) {
        sessionStore.update(lookup.viewerBufnr, {
          lspMirror: { ...mirror, bufferStale: false },
        });
      }
      return Promise.resolve();
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
