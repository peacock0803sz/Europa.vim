import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import {
  changeCellType as changeNotebookCellType,
} from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import { resolveScratchFiletype } from "../../view/viewer.ts";
import { type DispatcherContext, echomError } from "../context.ts";
import { operateCell } from "./_operator.ts";

export function buildChangeTypeDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "changeCellType"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Change a cell's type and update the viewer and any open scratch buffer.
     *
     * @spec-id europa.dispatcher.change-cell-type
     */
    async changeCellType(
      bufnr: unknown,
      cellId: unknown,
      newType: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `changeCellType: no session for buffer ${bn}`);
        return;
      }
      const validTypes = ["code", "markdown", "raw"] as const;
      const typeStr = String(newType);
      if (!validTypes.includes(typeStr as typeof validTypes[number])) {
        await echomError(
          denops,
          `changeCellType: invalid type '${typeStr}'; must be code, markdown, or raw`,
        );
        return;
      }
      const nt = typeStr as "code" | "markdown" | "raw";
      const cid = String(cellId);
      const cellExists = session.notebook.cells.some((c) => c.id === cid);
      if (!cellExists) {
        await echomError(denops, `changeCellType: cell '${cid}' not found`);
        return;
      }
      const preChangeSnapshot = takeStructuralSnapshot(session.notebook);
      const newNotebook = changeNotebookCellType(session.notebook, cid, nt);
      if (Object.is(newNotebook, session.notebook)) return;
      session.undoHistory.push({
        opType: "changeCellType",
        snapshot: preChangeSnapshot,
        beforeHint: { kind: "single", cellId: cid },
        afterHint: { kind: "single", cellId: cid },
      });
      await operateCell(ctx, {
        bufnr: bn,
        opName: "changeCellType",
        session,
        mutate: () => ({ notebook: newNotebook }),
      });

      const scratchBufnr = sessionStore.getScratchBufnr(bn, cid);
      if (scratchBufnr !== undefined) {
        const scratchExists = await denops.call("bufexists", scratchBufnr);
        if (scratchExists) {
          const newCell = newNotebook.cells.find((c) => c.id === cid);
          if (newCell) {
            const newFiletype = resolveScratchFiletype(newNotebook, newCell);
            await denops.call(
              "setbufvar",
              scratchBufnr,
              "&filetype",
              newFiletype,
            );
          }
        }
      }
    },
  };
}
