import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { EuropaKernelError } from "../../kernel/errors.ts";
import { cancelQueued } from "../../session/pending-requests.ts";
import { type DispatcherContext, vimSingleQuote } from "../context.ts";

export function buildCancelDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "cancelCell"> {
  const { denops, sessionStore } = ctx;
  return {
    // @spec-id europa.dispatcher.cancel-cell
    async cancelCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `cancelCell: invalid bufnr '${_bufnr}'`,
        );
      }
      if (typeof _cellId !== "string" || _cellId.length === 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `cancelCell: cellId must be a non-empty string`,
        );
      }
      const cellId = _cellId;

      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;
      if (!kr) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: No kernel attached.")}`,
        );
        return;
      }

      if (cancelQueued(kr, cellId)) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: Cancelled queued cell")}`,
        );
        return;
      }

      const state = kr.cellStates.get(cellId);
      if (state === "busy") {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Cell is already running. Use :EuropaInterrupt to stop.",
            )
          }`,
        );
        return;
      }

      const cell = session!.notebook.cells.find((c) => c.id === cellId);
      if (!cell) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: No cell at cursor")}`,
        );
        return;
      }

      await denops.cmd(
        `echom ${
          vimSingleQuote(
            `Europa: Cell is not queued (state=${state ?? "idle"})`,
          )
        }`,
      );
    },
  };
}
