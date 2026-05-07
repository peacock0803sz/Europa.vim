import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import { EuropaKernelError } from "../../kernel/errors.ts";
import { type DispatcherContext, vimSingleQuote } from "../context.ts";

export function buildInterruptDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "interruptKernel"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * @spec-id europa.dispatcher.interrupt-kernel
     * @spec-id europa.kernel.interrupt.idle-no-op
     * @spec-id europa.kernel.interrupt.reconnect-mid
     */
    async interruptKernel(_bufnr: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `interruptKernel: invalid bufnr '${_bufnr}'`,
        );
      }

      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;
      if (!kr) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: No kernel attached.")}`,
        );
        return;
      }

      if (kr.execState === "restarting") {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Cannot interrupt while kernel is restarting, please wait",
            )
          }`,
        );
        return;
      }
      if (kr.reconnect) {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Cannot interrupt during reconnect, please wait",
            )
          }`,
        );
        return;
      }

      if (kr.execState === "idle") {
        await denops.cmd(
          `echom ${
            vimSingleQuote("Europa: Kernel is idle, nothing to interrupt")
          }`,
        );
      }

      try {
        await kr.client.interrupt();
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: Interrupt sent")}`,
        );
      } catch (e) {
        const msg = e instanceof EuropaKernelError ? e.message : String(e);
        await denops.cmd(
          `echom ${vimSingleQuote(`Europa: Interrupt failed: ${msg}`)}`,
        );
      }
    },
  };
}
