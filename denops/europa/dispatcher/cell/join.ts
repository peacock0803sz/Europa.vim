import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { joinCell as joinNotebookCell } from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import {
  closeCellEditAutocmds,
  freezeCellEditBuffer,
} from "../../view/viewer.ts";
import {
  type DispatcherContext,
  echomError,
  vimSingleQuote,
} from "../context.ts";
import { operateCell, refuseIfScratchDirty } from "./_operator.ts";

export function buildJoinCellDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "joinCell"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Merge the target cell into the cell immediately above it.
     *
     * @spec-id europa.dispatcher.join-cell
     */
    async joinCell(bufnr: unknown, cellId: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `joinCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const idx = session.notebook.cells.findIndex((c) => c.id === cid);
      if (idx === -1) {
        await echomError(denops, `joinCell: cell '${cid}' not found`);
        return;
      }
      if (idx === 0) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: No cell above to join")
          } | echohl None`,
        );
        return;
      }
      const prevCellId = session.notebook.cells[idx - 1].id;
      if (await refuseIfScratchDirty(ctx, bn, cid)) return;
      if (await refuseIfScratchDirty(ctx, bn, prevCellId)) return;

      const preJoinSnapshot = takeStructuralSnapshot(session.notebook);
      const newNotebook = joinNotebookCell(session.notebook, cid);
      if (Object.is(newNotebook, session.notebook)) return;
      session.undoHistory.push({
        opType: "joinCell",
        snapshot: preJoinSnapshot,
        beforeHint: { kind: "split", primaryCellId: prevCellId },
        afterHint: { kind: "join", primaryCellId: prevCellId },
      });

      await operateCell(ctx, {
        bufnr: bn,
        opName: "joinCell",
        session,
        mutate: () => ({ notebook: newNotebook, preferCellId: prevCellId }),
      });

      const targetScratchBufnr = sessionStore.getScratchBufnr(bn, cid);
      if (targetScratchBufnr !== undefined) {
        const exists = await denops.call("bufexists", targetScratchBufnr);
        if (exists) {
          await freezeCellEditBuffer(denops, targetScratchBufnr, cid);
        }
        await closeCellEditAutocmds(denops, targetScratchBufnr);
        sessionStore.removeCellEditBuffer(bn, cid);
      }
      const survivingScratchBufnr = sessionStore.getScratchBufnr(
        bn,
        prevCellId,
      );
      if (survivingScratchBufnr !== undefined) {
        const survivingExists = await denops.call(
          "bufexists",
          survivingScratchBufnr,
        );
        if (survivingExists) {
          const merged = newNotebook.cells.find((c) => c.id === prevCellId);
          if (merged) {
            const mergedLines = merged.source.split("\n");
            await denops.call("deletebufline", survivingScratchBufnr, 1, "$");
            await denops.call(
              "setbufline",
              survivingScratchBufnr,
              1,
              mergedLines,
            );
            await denops.call(
              "setbufvar",
              survivingScratchBufnr,
              "&modified",
              0,
            );
          }
        }
      }
    },
  };
}
