import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import type { DispatcherContext } from "../context.ts";
import { buildCancelDispatcher } from "./cancel.ts";
import { buildInterruptDispatcher } from "./interrupt.ts";
import { buildRestartDispatcher } from "./restart.ts";
import { buildRunAllDispatcher } from "./run-all.ts";
import { buildRunCellDispatcher } from "./run-cell.ts";

export function buildExecDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  | "runCell"
  | "runAll"
  | "cancelCell"
  | "interruptKernel"
  | "restartKernel"
> {
  return {
    ...buildRunCellDispatcher(ctx),
    ...buildRunAllDispatcher(ctx),
    ...buildCancelDispatcher(ctx),
    ...buildInterruptDispatcher(ctx),
    ...buildRestartDispatcher(ctx),
  };
}
