import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import type { KernelStatusReport } from "../../../schema/session.ts";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import { createKernelClient } from "../kernel/client.ts";
import { EuropaKernelError } from "../kernel/errors.ts";
import { createIopubBatchScheduler } from "../render/iopub-batch.ts";
import { cleanupMirrorFile } from "../lsp/workspace.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "./context.ts";
import { UnimplementedError } from "./errors.ts";
import { scheduleHighlightRefresh } from "./syntax-highlight.ts";

export function buildKernelDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  | "startKernel"
  | "shutdownKernel"
  | "kernelStatus"
  | "atexit"
  | "attachKernel"
> {
  const { denops, sessionStore, serverPool } = ctx;
  return {
    /**
     * Starts a kernel for the given viewer buffer.
     *
     * @spec-id europa.dispatcher.start-kernel
     */
    async startKernel(bufnr: unknown, kernelName?: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `startKernel: invalid bufnr '${bufnr}'`,
        );
      }
      if (
        kernelName !== undefined && kernelName !== null && kernelName !== ""
      ) {
        if (typeof kernelName !== "string" && typeof kernelName !== "number") {
          throw new EuropaKernelError(
            "INVALID_ARGS",
            `startKernel: kernelName must be a string or number`,
          );
        }
      }

      if (!sessionStore.get(bn)) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `startKernel: bufnr ${bn} has no open notebook session`,
        );
      }

      const config = await loadConfig(denops);
      const kn = (kernelName != null && String(kernelName).length > 0)
        ? String(kernelName)
        : config.default_kernel;

      const client = createKernelClient(denops, config, serverPool);
      try {
        const cwd = await denops.call("expand", `#${bn}:p:h`) as string;
        const runtime = await client.start({ kernelName: kn, cwd });
        const caps = await detectCapabilities(denops);
        runtime.iopubBatchScheduler = createIopubBatchScheduler({
          denops,
          bufnr: bn,
          getNotebook: () => sessionStore.get(bn)!.notebook,
          caps,
          renderOpts: renderPlanOpts(config),
          // Keep the cached RenderPlan in sync with the streaming flush so
          // tree-sitter cellSourceRanges do not drift after every cell run.
          // Covered by europa.render.iopub-batch.plan-applied-callback.
          onPlanApplied: (plan) => {
            sessionStore.setRenderPlan(bn, plan);
            scheduleHighlightRefresh(ctx, bn);
          },
        });
        sessionStore.update(bn, { kernelRuntime: runtime });
      } catch (e) {
        const code = (e instanceof EuropaKernelError) ? ` [${e.code}]` : "";
        await echomError(
          denops,
          `startKernel failed${code}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },

    /**
     * Shuts down the kernel attached to the given viewer buffer.
     *
     * @spec-id europa.dispatcher.shutdown-kernel
     */
    async shutdownKernel(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session?.kernelRuntime) return;
      const { client, iopubBatchScheduler } = session.kernelRuntime;
      await iopubBatchScheduler?.dispose();
      try {
        await client.shutdown();
      } catch (e) {
        const code = (e instanceof EuropaKernelError) ? ` [${e.code}]` : "";
        await echomError(
          denops,
          `shutdownKernel failed${code}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      sessionStore.update(bn, { kernelRuntime: undefined });
    },

    /**
     * Returns the current connection status of the kernel attached to the
     * given viewer buffer.
     *
     * @spec-id europa.dispatcher.kernel-status
     */
    kernelStatus(bufnr: unknown): Promise<KernelStatusReport> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;

      if (!kr) {
        return Promise.resolve({ info: null, wsState: "NONE" });
      }

      const WS_STATE_NAMES = [
        "CONNECTING",
        "OPEN",
        "CLOSING",
        "CLOSED",
      ] as const;
      const wsState = WS_STATE_NAMES[kr.socket.readyState] ?? "CLOSED";

      const handles = serverPool.snapshot();
      const poolHandle = handles.find((h) => h.serverKey === kr.serverKey);

      const report: KernelStatusReport = {
        info: kr.info,
        wsState,
        ...(kr.reconnect ? { reconnect: kr.reconnect } : {}),
        ...(poolHandle ? { serverRefcount: poolHandle.refcount } : {}),
      };

      return Promise.resolve(report);
    },

    /**
     * Shuts down all active kernels and kills any remaining server processes.
     *
     * @spec-id europa.dispatcher.atexit
     */
    async atexit(): Promise<void> {
      const sessions = sessionStore.all();
      // Phase 3.9: best-effort remove any materialized mirror files on exit
      // (FR-018). Only files are removed, never the shared mirror dir.
      await Promise.all(
        sessions
          .filter((s) => s.lspMirror != null)
          .map((s) =>
            cleanupMirrorFile(s.lspMirror!.mirrorPath).catch(() => {})
          ),
      );
      await Promise.all(
        sessions
          .filter((s) => s.kernelRuntime != null)
          .map(async (s) => {
            try {
              await s.kernelRuntime!.iopubBatchScheduler?.dispose();
              await s.kernelRuntime!.client.shutdown();
            } catch { /* shutdown errors during exit are best-effort */ }
          }),
      );
      await serverPool.killAll();
    },

    // Phase 4: ZMQ attach
    attachKernel(_connectionFile: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("attachKernel"));
    },
  };
}
