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
     * @spec-id europa.dispatcher.restart-comm-preserve-on-fail
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
        // closeAll must run AFTER client.restart() resolves because
        // RESTART_REST_FAILED preserves the old kernel and socket
        // (kernel/restart.ts:149-160 — FR-013 fallback). Firing
        // frontend-restart events before the restart commit would
        // permanently desync the registry from the still-live kernel-side
        // comm map: surviving comms would reject locally and inbound
        // comm_msg / comm_close for kernel-side comms would hit an empty
        // registry. Once client.restart() succeeds the kernel has wiped
        // its comm state, so closing locally is sound.
        await kr.commService?.closeAll("restart");

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
        // RESTART_HANDSHAKE_FAILED means client.restart() got past REST
        // 200 (kernel-side comm map already wiped) but the new WebSocket
        // open or kernel_info handshake failed afterwards. Leaving the
        // local CommRegistry intact would diverge from the empty
        // kernel-side state: send() would target comm_ids the kernel has
        // forgotten, and inbound comm_msg for old ids could never arrive.
        // RESTART_REST_FAILED is the opposite case where the old kernel
        // survives, so the registry must be preserved exactly as it was.
        if (
          e instanceof EuropaKernelError &&
          e.code === "RESTART_HANDSHAKE_FAILED"
        ) {
          try {
            await kr.commService?.closeAll("restart");
          } catch { /* best-effort */ }
        }
        const msg = e instanceof EuropaKernelError ? e.message : String(e);
        await denops.cmd(
          `echom ${vimSingleQuote(`Europa: Kernel restart failed: ${msg}`)}`,
        );
      }
    },
  };
}
