import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { moveCell as moveNotebookCell } from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import {
  type DispatcherContext,
  echomError,
  vimSingleQuote,
} from "../context.ts";
import { operateCell } from "./_operator.ts";

export function buildMoveCellDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "moveCell"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Swap a cell with its neighbour above (`up`) or below (`down`).
     *
     * @spec-id europa.dispatcher.move-cell
     */
    async moveCell(
      bufnr: unknown,
      cellId: unknown,
      direction: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `moveCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const validDirections = ["up", "down"] as const;
      const dirStr = String(direction);
      if (!validDirections.includes(dirStr as typeof validDirections[number])) {
        await echomError(denops, `moveCell: invalid direction '${dirStr}'`);
        return;
      }
      const dir = dirStr as "up" | "down";
      const idx = session.notebook.cells.findIndex((c) => c.id === cid);
      if (idx === -1) {
        await echomError(denops, `moveCell: cell '${cid}' not found`);
        return;
      }
      const preMoveSnapshot = takeStructuralSnapshot(session.notebook);
      const newNotebook = moveNotebookCell(session.notebook, cid, dir);
      if (Object.is(newNotebook, session.notebook)) {
        const guidance = dir === "up" ? "Already at top" : "Already at bottom";
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote(`Europa: ${guidance}`)
          } | echohl None`,
        );
        return;
      }
      session.undoHistory.push({
        opType: "moveCell",
        snapshot: preMoveSnapshot,
        beforeHint: { kind: "single", cellId: cid },
        afterHint: { kind: "single", cellId: cid },
      });
      await operateCell(ctx, {
        bufnr: bn,
        opName: "moveCell",
        session,
        mutate: () => ({ notebook: newNotebook, preferCellId: cid }),
      });
    },
  };
}
