import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { splitCell as splitNotebookCell } from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import { type DispatcherContext, echomError } from "../context.ts";
import { operateCell, refuseIfScratchDirty } from "./_operator.ts";

export function buildSplitCellDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "splitCell"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Split the cell at the given line into two consecutive cells.
     *
     * @spec-id europa.dispatcher.split-cell
     */
    async splitCell(
      bufnr: unknown,
      cellId: unknown,
      line: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const cid = String(cellId);
      const ln = Number(line);
      if (!Number.isInteger(ln) || ln < 1) {
        await echomError(denops, `splitCell: invalid line '${line}'`);
        return;
      }

      const reverseLookup = sessionStore.findViewerByScratchBufnr(bn);
      let viewerBufnr: number;
      let splitLine: number;
      if (reverseLookup) {
        viewerBufnr = reverseLookup.viewerBufnr;
        if (reverseLookup.cellId !== cid) {
          await echomError(
            denops,
            `splitCell: scratch buffer ${bn} does not own cell '${cid}'`,
          );
          return;
        }
        splitLine = ln - 1;
      } else {
        viewerBufnr = bn;
        const session = sessionStore.get(viewerBufnr);
        if (!session) {
          await echomError(denops, `splitCell: no session for buffer ${bn}`);
          return;
        }
        const cell = session.notebook.cells.find((c) => c.id === cid);
        if (!cell) {
          await echomError(denops, `splitCell: cell '${cid}' not found`);
          return;
        }
        const plan = sessionStore.getRenderPlan(viewerBufnr);
        const range = plan?.cellRanges.find((r) => r.cellId === cid);
        if (!range) {
          await echomError(
            denops,
            `splitCell: no render plan range for cell '${cid}'`,
          );
          return;
        }
        const userLine0 = ln - 1;
        const sourceStart = range.startLine + 1;
        const sourceLineCount = cell.source.split("\n").length;
        const sourceEnd = sourceStart + sourceLineCount - 1;
        if (userLine0 < sourceStart) {
          splitLine = 0;
        } else if (userLine0 > sourceEnd) {
          splitLine = sourceLineCount;
        } else {
          splitLine = userLine0 - sourceStart;
        }
      }

      const session = sessionStore.get(viewerBufnr);
      if (!session) {
        await echomError(
          denops,
          `splitCell: no session for viewer buffer ${viewerBufnr}`,
        );
        return;
      }
      if (await refuseIfScratchDirty(ctx, viewerBufnr, cid)) return;

      const preSplitSnapshot = takeStructuralSnapshot(session.notebook);
      let newNotebook: typeof session.notebook;
      try {
        newNotebook = splitNotebookCell(session.notebook, cid, splitLine);
      } catch (e) {
        await echomError(
          denops,
          `splitCell: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      session.undoHistory.push({
        opType: "splitCell",
        snapshot: preSplitSnapshot,
        beforeHint: { kind: "join", primaryCellId: cid },
        afterHint: { kind: "split", primaryCellId: cid },
      });
      await operateCell(ctx, {
        bufnr: viewerBufnr,
        opName: "splitCell",
        session,
        mutate: () => ({ notebook: newNotebook, preferCellId: cid }),
      });

      const scratchBufnr = sessionStore.getScratchBufnr(viewerBufnr, cid);
      if (scratchBufnr !== undefined) {
        const exists = await denops.call("bufexists", scratchBufnr);
        if (exists) {
          const upperCell = newNotebook.cells.find((c) => c.id === cid);
          if (upperCell) {
            const upperLines = upperCell.source.split("\n");
            await denops.call("deletebufline", scratchBufnr, 1, "$");
            await denops.call("setbufline", scratchBufnr, 1, upperLines);
            await denops.call("setbufvar", scratchBufnr, "&modified", 0);
          }
        }
      }
    },
  };
}
