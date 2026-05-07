import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import type { CodeCell } from "../../../../schema/notebook.ts";
import { EuropaKernelError } from "../../kernel/errors.ts";
import {
  applyMessageToCell,
  execute as kernelExecute,
} from "../../kernel/execute.ts";
import { complete, enqueue, markSent } from "../../session/pending-requests.ts";
import { type DispatcherContext, vimSingleQuote } from "../context.ts";

export function buildRunAllDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "runAll"> {
  const { denops, sessionStore } = ctx;
  return {
    // @spec-id europa.dispatcher.run-all
    async runAll(_bufnr: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `runAll: invalid bufnr '${_bufnr}'`,
        );
      }

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

      if (kr.execState === "busy") {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Kernel is busy. Wait for the current execution to finish.",
            )
          }`,
        );
        return;
      }

      const allCells = session!.notebook.cells;
      const codeCells = allCells.filter((c) => c.cell_type === "code");
      const nonCodeSkipped = allCells.length - codeCells.length;

      const entries: Array<{ cell: typeof codeCells[0]; msgId: string }> = [];
      for (const cell of codeCells) {
        let msgId: string | undefined;
        for (const [mid, entry] of kr.pendingRequests.entries()) {
          if (entry.cellId === cell.id && entry.state === "queued") {
            msgId = mid;
            break;
          }
        }
        msgId ??= enqueue(kr, bn, cell.id);
        entries.push({ cell, msgId });
      }

      kr.execState = "busy";
      let completed = 0;
      let cancelledSkipped = 0;
      let errorStopped = false;
      const totalCode = codeCells.length;

      try {
        for (const { cell, msgId } of entries) {
          if (!kr.pendingRequests.has(msgId)) {
            cancelledSkipped++;
            continue;
          }

          const codeCell = cell as CodeCell;
          const code = codeCell.source;
          codeCell.outputs = [];

          markSent(kr, msgId);
          const runAllSignal = kr.abort.signal;
          let execStatus = "ok";
          // @spec-id europa.dispatcher.runall-batch-driven
          try {
            for await (
              const msg of kernelExecute(kr, code, {
                msgId,
                signal: runAllSignal,
              })
            ) {
              applyMessageToCell(codeCell, msg);
              kr.iopubBatchScheduler?.enqueue(msg, codeCell.id);
              if (msg.header.msg_type === "execute_reply") {
                await kr.iopubBatchScheduler?.flushNow();
                if ((msg.content as { status?: string }).status) {
                  execStatus = (msg.content as { status: string }).status;
                }
              }
            }
          } catch {
            execStatus = "error";
          } finally {
            complete(kr, msgId);
          }

          completed++;

          if (execStatus === "error") {
            for (const remaining of entries) {
              if (kr.pendingRequests.has(remaining.msgId)) {
                kr.pendingRequests.delete(remaining.msgId);
                kr.cellStates.set(remaining.cell.id, "idle");
                cancelledSkipped++;
              }
            }
            await denops.cmd(
              `echom ${
                vimSingleQuote(
                  `Europa: Run all stopped at cell ${completed}/${totalCode} due to error`,
                )
              }`,
            );
            errorStopped = true;
            break;
          }
        }
      } finally {
        if (kr.execState === "busy") kr.execState = "idle";
      }

      if (!errorStopped) {
        const skipParts: string[] = [];
        if (nonCodeSkipped > 0) skipParts.push(`${nonCodeSkipped} non-code`);
        if (cancelledSkipped > 0) {
          skipParts.push(`${cancelledSkipped} cancelled`);
        }
        const skipSuffix = skipParts.length > 0
          ? ` (skipped ${skipParts.join(", ")})`
          : "";
        await denops.cmd(
          `echom ${
            vimSingleQuote(`Europa: Ran ${completed} code cells${skipSuffix}`)
          }`,
        );
      }
    },
  };
}
