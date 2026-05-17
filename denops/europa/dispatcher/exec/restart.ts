import type { EuropaDispatcher } from "../../../../contracts/dispatcher.ts";
import type { CodeCell } from "../../../../schema/notebook.ts";
import { detectCapabilities } from "../../capabilities.ts";
import { loadConfig } from "../../config.ts";
import { EuropaKernelError } from "../../kernel/errors.ts";
import { buildRenderPlan } from "../../render/builder.ts";
import { applyRenderPlan } from "../../view/viewer.ts";
import {
  type DispatcherContext,
  renderPlanOpts,
  vimSingleQuote,
} from "../context.ts";
import { scheduleHighlightRefresh } from "../syntax-highlight.ts";

export function buildRestartDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "restartKernel"> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * @spec-id europa.dispatcher.restart-kernel
     * @spec-id europa.kernel.restart.exec-count-reset
     */
    async restartKernel(_bufnr: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `restartKernel: invalid bufnr '${_bufnr}'`,
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

      kr.execState = "restarting";

      try {
        await kr.client.restart();

        for (const cell of session!.notebook.cells) {
          if (cell.cell_type === "code") {
            (cell as CodeCell).execution_count = null;
          }
        }

        try {
          const config = await loadConfig(denops);
          const caps = await detectCapabilities(denops);
          const plan = await buildRenderPlan(
            session!.notebook,
            caps,
            renderPlanOpts(config),
          );
          sessionStore.setRenderPlan(bn, plan);
          await applyRenderPlan(denops, bn, plan);
          scheduleHighlightRefresh(ctx, bn); // FR-007: post-restart follow-up
        } catch {
          // Re-render failure is non-fatal.
        }

        await denops.cmd(
          `echom ${vimSingleQuote("Europa: Kernel restarted")}`,
        );
      } catch (e) {
        if (kr.execState === "restarting") kr.execState = "idle";
        const msg = e instanceof EuropaKernelError ? e.message : String(e);
        await denops.cmd(
          `echom ${vimSingleQuote(`Europa: Kernel restart failed: ${msg}`)}`,
        );
      }
    },
  };
}
