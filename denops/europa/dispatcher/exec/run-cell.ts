import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import type { CodeCell } from "../../../../schema/notebook.ts";
import { EuropaKernelError } from "../../kernel/errors.ts";
import {
  applyMessageToCell,
  execute as kernelExecute,
} from "../../kernel/execute.ts";
import { complete, enqueue, markSent } from "../../session/pending-requests.ts";
import {
  type DispatcherContext,
  echomError,
  vimSingleQuote,
} from "../context.ts";

export function buildRunCellDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "runCell"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * @spec-id europa.contract.dispatcher-phase3-3-alignment
     * @spec-id europa.dispatcher.run-cell
     * @spec-id europa.dispatcher.run-cell-queued-on-busy
     */
    async runCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `runCell: invalid bufnr '${_bufnr}'`,
        );
      }
      if (typeof _cellId !== "string" || _cellId.length === 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `runCell: cellId must be a non-empty string`,
        );
      }
      const cellId = _cellId;

      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;
      if (!kr) {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: No kernel attached. Use :EuropaStartKernel first.",
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

      if (cell.cell_type !== "code") {
        await denops.cmd(
          `echom ${
            vimSingleQuote("Europa: Cannot run a non-code cell (markdown/raw)")
          }`,
        );
        return;
      }

      const codeCell = cell as CodeCell;
      const currentCellState = kr.cellStates.get(cellId);

      if (currentCellState === "busy") {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Cell is already running. Use :EuropaInterrupt first.",
            )
          }`,
        );
        return;
      }

      let redispatchMsgId: string | undefined;
      if (currentCellState === "queued") {
        if (kr.execState === "busy") {
          await denops.cmd(
            `echom ${
              vimSingleQuote(
                "Europa: Cell is already queued. Use :EuropaCancelCell to cancel.",
              )
            }`,
          );
          return;
        }
        for (const [msgId, entry] of kr.pendingRequests.entries()) {
          if (entry.cellId === cellId && entry.state === "queued") {
            redispatchMsgId = msgId;
            break;
          }
        }
        if (!redispatchMsgId) {
          kr.cellStates.set(cellId, "idle");
        }
      }

      if (kr.execState === "busy" && !redispatchMsgId) {
        enqueue(kr, bn, cellId);
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Kernel is busy. Wait for the current execution to finish.",
            )
          }`,
        );
        return;
      }

      const code = codeCell.source;
      const msgId = redispatchMsgId ?? enqueue(kr, bn, cellId);

      codeCell.outputs = [];
      kr.execState = "busy";
      markSent(kr, msgId);
      const execSignal = kr.abort.signal;
      // @spec-id europa.dispatcher.runcell-batch-driven
      // @spec-id europa.session.hidden-buffer.outputs-still-update
      try {
        for await (
          const msg of kernelExecute(kr, code, { msgId, signal: execSignal })
        ) {
          applyMessageToCell(codeCell, msg);
          kr.iopubBatchScheduler?.enqueue(msg, cellId);
          if (msg.header.msg_type === "execute_reply") {
            await kr.iopubBatchScheduler?.flushNow();
          }
          if (
            msg.header.msg_type === "status" &&
            (msg.content as { execution_state?: string })
                .execution_state === "idle" &&
            (msg.parent_header as { msg_id?: string }).msg_id === msgId
          ) {
            await kr.iopubBatchScheduler?.flushNow();
            if (kr.execState === "busy") kr.execState = "idle";
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          kr.cellStates.set(cellId, "aborted");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          await echomError(denops, `Execution error: ${msg}`);
        }
      } finally {
        complete(kr, msgId);
        if (kr.execState === "busy") kr.execState = "idle";
      }
    },
  };
}
