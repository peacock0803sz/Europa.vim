import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { insertCell as insertNotebookCell } from "../../notebook/cell.ts";
import { takeStructuralSnapshot } from "../../notebook/structural-snapshot.ts";
import { type DispatcherContext, echomError } from "../context.ts";
import { operateCell } from "./_operator.ts";

export function buildInsertCellDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "insertCell"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Insert a new empty cell adjacent to the anchor cell.
     *
     * @spec-id europa.dispatcher.insert-cell
     * @spec-id europa.dispatcher.cellops-flush-on-entry
     */
    async insertCell(
      bufnr: unknown,
      type: unknown,
      position: unknown,
      anchorCellId: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `insertCell: no session for buffer ${bn}`);
        return;
      }
      const validTypes = ["code", "markdown", "raw"] as const;
      const validPositions = ["before", "after"] as const;
      const typeStr = String(type);
      const posStr = String(position);
      if (!validTypes.includes(typeStr as typeof validTypes[number])) {
        await echomError(denops, `insertCell: invalid type '${typeStr}'`);
        return;
      }
      if (!validPositions.includes(posStr as typeof validPositions[number])) {
        await echomError(denops, `insertCell: invalid position '${posStr}'`);
        return;
      }
      const anchorId = anchorCellId == null ? null : String(anchorCellId);
      if (
        (anchorId === null || anchorId === "") &&
        session.notebook.cells.length > 0
      ) {
        await echomError(
          denops,
          "insertCell: no cell at cursor; cannot resolve anchor",
        );
        return;
      }

      const preSnapshot = takeStructuralSnapshot(session.notebook);
      await operateCell(ctx, {
        bufnr: bn,
        opName: "insertCell",
        session,
        mutate(currentSession) {
          const result = insertNotebookCell(
            currentSession.notebook,
            posStr as "before" | "after",
            typeStr as "code" | "markdown" | "raw",
            anchorId === "" ? null : anchorId,
          );
          currentSession.undoHistory.push({
            opType: "insertCell",
            snapshot: preSnapshot,
            beforeHint: {
              kind: "anchor",
              cellId: anchorId === "" ? null : anchorId,
              position: posStr === "before" ? "above" : "below",
            },
            afterHint: { kind: "single", cellId: result.cellId },
          });
          return {
            notebook: result.notebook,
            preferCellId: result.cellId,
          };
        },
      }).catch(async (e) => {
        await echomError(
          denops,
          `insertCell: ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      });
    },
  };
}
