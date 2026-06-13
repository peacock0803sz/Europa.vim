import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import type { DispatcherContext } from "../context.ts";
import { buildChangeTypeDispatcher } from "./change-type.ts";
import { buildDeleteCellDispatcher } from "./delete.ts";
import { buildEditCellDispatcher } from "./edit.ts";
import { buildInsertCellDispatcher } from "./insert.ts";
import { buildJoinCellDispatcher } from "./join.ts";
import { buildMoveCellDispatcher } from "./move.ts";
import { buildSplitCellDispatcher } from "./split.ts";

export function buildCellDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  | "insertCell"
  | "deleteCell"
  | "moveCell"
  | "splitCell"
  | "joinCell"
  | "editCell"
  | "changeCellType"
  | "saveCellEdit"
  | "closeCellEdit"
  | "mirrorReloaded"
  | "lineToCellId"
> {
  return {
    ...buildInsertCellDispatcher(ctx),
    ...buildDeleteCellDispatcher(ctx),
    ...buildMoveCellDispatcher(ctx),
    ...buildSplitCellDispatcher(ctx),
    ...buildJoinCellDispatcher(ctx),
    ...buildEditCellDispatcher(ctx),
    ...buildChangeTypeDispatcher(ctx),
  };
}
