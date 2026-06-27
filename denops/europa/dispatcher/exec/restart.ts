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

      // Snapshot the pre-restart comm entries because client.restart()
      // reopens the WebSocket and reattaches message dispatch internally,
      // so the restarted kernel can push comm_open into the registry
      // during the restart. closeAll on the live registry afterwards
      // would wipe those just-arrived post-restart entries together with
      // the pre-restart ones — the snapshot lets us close only the
      // entries that existed before the kernel-side reset.
      const preRestartEntries = kr.commService?.list().slice() ?? [];
      const fireFrontendRestart = (): void => {
        for (const entry of preRestartEntries) {
          try {
            entry.handle._fireOnClose({}, [], "frontend-restart");
          } catch { /* best-effort */ }
        }
      };

      try {
        await kr.client.restart();
        // Success path: the kernel has wiped its comm state, so close
        // every pre-restart handle. Post-restart entries that the new
        // kernel may have opened during the restart survive because they
        // are not in the snapshot.
        fireFrontendRestart();

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
        // open or kernel_info handshake failed afterwards. The pre-restart
        // snapshot must be closed because the kernel forgot those comms;
        // post-restart entries (if any reached the registry before the
        // handshake failed) are preserved by the same snapshot logic.
        // RESTART_REST_FAILED is the opposite case where the old kernel
        // survives, so the snapshot is NOT touched and every pre-restart
        // comm stays live.
        if (
          e instanceof EuropaKernelError &&
          e.code === "RESTART_HANDSHAKE_FAILED"
        ) {
          fireFrontendRestart();
        }
        const msg = e instanceof EuropaKernelError ? e.message : String(e);
        await denops.cmd(
          `echom ${vimSingleQuote(`Europa: Kernel restart failed: ${msg}`)}`,
        );
      }
    },
  };
}
