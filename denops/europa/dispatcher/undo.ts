import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import type {
  UndoAffectedCellHint,
  UndoEntry,
} from "../../../contracts/undo-history.ts";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import {
  restoreStructural,
  takeStructuralSnapshot,
} from "../notebook/structural-snapshot.ts";
import { buildRenderPlan } from "../render/builder.ts";
import { applyRenderPlan } from "../view/viewer.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
  vimSingleQuote,
} from "./context.ts";
import { scheduleHighlightRefresh } from "./syntax-highlight.ts";

function resolveAffectedCellId(
  hint: UndoAffectedCellHint,
  notebook: { cells: { id: string }[] },
): string | null {
  if (hint.kind === "single" || hint.kind === "delete-resurrect") {
    return hint.cellId;
  }
  if (hint.kind === "split" || hint.kind === "join") {
    return hint.primaryCellId;
  }
  if (hint.cellId === null) {
    return hint.position === "above"
      ? (notebook.cells[0]?.id ?? null)
      : (notebook.cells[notebook.cells.length - 1]?.id ?? null);
  }
  return hint.cellId;
}

/**
 * Process one undo or redo step (10-step path, FR-018 2-stage try-catch).
 * Called by the UndoHistory FIFO queue processor.
 * @spec-id europa.dispatcher.europa-undo-affected-cell-cursor
 * @spec-id europa.dispatcher.europa-undo-iopub-flush
 * @spec-id europa.dispatcher.europa-undo-empty-stack-warn
 * @spec-id europa.dispatcher.europa-undo-render-failure
 * @spec-id europa.dispatcher.europa-redo-render-failure
 * @spec-id europa.dispatcher.europa-redo-invalidate-on-mutation
 * @spec-id europa.dispatcher.europa-undo-scratch-dirty-refuse
 */
export async function processOne(
  ctx: DispatcherContext,
  bufnr: number,
  kind: "undo" | "redo",
): Promise<void> {
  const { denops, sessionStore } = ctx;
  const session = sessionStore.get(bufnr);
  if (!session) return;

  const savedPreSnapshot = takeStructuralSnapshot(session.notebook);

  {
    const peekEntry = kind === "undo"
      ? session.undoHistory.peekUndo()
      : session.undoHistory.peekRedo();
    if (peekEntry) {
      const affectedId = resolveAffectedCellId(
        kind === "undo" ? peekEntry.beforeHint : peekEntry.afterHint,
        session.notebook,
      );
      if (affectedId) {
        const scrBn = sessionStore.getScratchBufnr(bufnr, affectedId);
        if (scrBn !== undefined) {
          const isSelfSave = peekEntry.opType === "saveCellEdit" &&
            peekEntry.scratchSync?.cellId === affectedId;
          if (!isSelfSave) {
            const modified = await denops.call(
              "getbufvar",
              scrBn,
              "&modified",
            );
            if (modified === 1 || modified === "1") {
              await denops.cmd(
                `echohl ErrorMsg | echom ${
                  vimSingleQuote(
                    `Europa: undo refused - scratch buffer for cell '${affectedId}' is dirty`,
                  )
                } | echohl None`,
              );
              return;
            }
          }
        }
      }
    }
  }

  await session.kernelRuntime?.iopubBatchScheduler?.flushNow?.();

  const entry = kind === "undo"
    ? session.undoHistory.popUndo()
    : session.undoHistory.popRedo();
  if (!entry) {
    await denops.cmd(
      `echohl WarningMsg | echom ${
        vimSingleQuote(
          kind === "undo"
            ? "Europa: nothing to undo"
            : "Europa: nothing to redo",
        )
      } | echohl None`,
    );
    return;
  }

  let restoredNotebook = session.notebook;

  try {
    restoredNotebook = restoreStructural(session.notebook, entry.snapshot);
    sessionStore.update(bufnr, {
      notebook: restoredNotebook,
      cellMap: sessionStore.getRenderPlan(bufnr)?.cellMap ?? [],
    });

    const config = await loadConfig(denops);
    const caps = await detectCapabilities(denops);
    const plan = await buildRenderPlan(
      restoredNotebook,
      caps,
      renderPlanOpts(config),
    );
    sessionStore.update(bufnr, { cellMap: plan.cellMap });
    sessionStore.setRenderPlan(bufnr, plan);

    if (entry.scratchSync) {
      const scrBn = sessionStore.getScratchBufnr(
        bufnr,
        entry.scratchSync.cellId,
      );
      if (scrBn !== undefined) {
        const newLines = entry.scratchSync.preSource.split("\n");
        await denops.call("setbufline", scrBn, 1, newLines);
        await denops.call("setbufvar", scrBn, "&modified", 0);
        const existingCount = (await denops.call(
          "getbufinfo",
          scrBn,
        ) as { linecount: number }[])[0]?.linecount ?? newLines.length;
        if (existingCount > newLines.length) {
          await denops.call(
            "deletebufline",
            scrBn,
            newLines.length + 1,
            existingCount,
          );
        }
      }
    }

    await applyRenderPlan(denops, bufnr, plan);
    scheduleHighlightRefresh(ctx, bufnr); // FR-007: undo/redo follow-up

    const affectedHint = kind === "undo" ? entry.beforeHint : entry.afterHint;
    const affectedCellId = resolveAffectedCellId(
      affectedHint,
      restoredNotebook,
    );
    const winid = await denops.call("bufwinid", bufnr) as number;
    if (winid > 0 && affectedCellId !== null) {
      const range = plan.cellRanges.find((r) => r.cellId === affectedCellId);
      if (range) {
        await denops.call(
          "win_execute",
          winid,
          `normal! ${range.startLine + 1}G`,
        );
      }
    }

    const oppositeSync = entry.scratchSync
      ? (() => {
        const snapCell = savedPreSnapshot.cells.find(
          (c) => c.id === entry.scratchSync!.cellId,
        );
        return snapCell
          ? { cellId: entry.scratchSync.cellId, preSource: snapCell.source }
          : entry.scratchSync;
      })()
      : undefined;
    const oppositeEntry: UndoEntry = {
      ...entry,
      snapshot: savedPreSnapshot,
      scratchSync: oppositeSync,
    };
    if (kind === "undo") {
      session.undoHistory.pushRedoFront(oppositeEntry);
    } else {
      session.undoHistory.pushUndoFront(oppositeEntry);
    }

    const newSnap = takeStructuralSnapshot(restoredNotebook);
    const savedSnap = session.lastSavedSnapshot;
    const isClean = savedSnap !== undefined &&
      JSON.stringify(newSnap) === JSON.stringify(savedSnap);
    await denops.call("setbufvar", bufnr, "&modified", isClean ? 0 : 1);
  } catch (_renderErr) {
    if (kind === "undo") {
      session.undoHistory.pushUndoFront(entry);
    } else {
      session.undoHistory.pushRedoFront(entry);
    }
    sessionStore.update(bufnr, {
      notebook: restoreStructural(
        session.notebook,
        savedPreSnapshot,
      ),
      cellMap: sessionStore.getRenderPlan(bufnr)?.cellMap ?? [],
    });
    const rolledBackSession = sessionStore.get(bufnr);
    if (!rolledBackSession) return;
    try {
      const config2 = await loadConfig(denops);
      const caps2 = await detectCapabilities(denops);
      const plan2 = await buildRenderPlan(
        rolledBackSession.notebook,
        caps2,
        renderPlanOpts(config2),
      );
      sessionStore.setRenderPlan(bufnr, plan2);
      await applyRenderPlan(denops, bufnr, plan2);
      scheduleHighlightRefresh(ctx, bufnr); // FR-007: undo fallback follow-up
    } catch {
      const verb = kind === "undo" ? "undo" : "redo";
      await denops.cmd(
        `echohl ErrorMsg | echom ${
          vimSingleQuote(
            `Europa: ${verb} failed - viewer rendering broken; please run :e! to reload`,
          )
        } | echohl None`,
      );
    }
  }
}

export function buildUndoDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "europaUndo" | "europaRedo"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Roll back one structural mutation for the given buffer.
     * @spec-id europa.dispatcher.europa-undo
     */
    async europaUndo(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bn}`);
        return;
      }
      const accepted = session.undoHistory.enqueueUndo();
      if (!accepted) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: undo busy, retry")
          } | echohl None`,
        );
      }
    },

    /**
     * Re-apply one undone structural mutation for the given buffer.
     * @spec-id europa.dispatcher.europa-redo
     */
    async europaRedo(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bn}`);
        return;
      }
      const accepted = session.undoHistory.enqueueRedo();
      if (!accepted) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: redo busy, retry")
          } | echohl None`,
        );
      }
    },
  };
}
