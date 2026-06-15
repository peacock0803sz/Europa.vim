import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import type { KernelStatusReport } from "../../../schema/session.ts";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import { createKernelClient, createZmqKernelClient } from "../kernel/client.ts";
import { EuropaKernelError } from "../kernel/errors.ts";
import { createIopubBatchScheduler } from "../render/iopub-batch.ts";
import { cleanupMirrorOnExit } from "../lsp/workspace.ts";
import {
  type DispatcherContext,
  echomError,
  echomInfo,
  renderPlanOpts,
} from "./context.ts";
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
     * @spec-id europa.dispatcher.kernel-status-zmq
     */
    kernelStatus(bufnr: unknown): Promise<KernelStatusReport> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;

      if (!kr) {
        return Promise.resolve({ info: null, wsState: "NONE" });
      }

      // D5: a ZMQ runtime has no WebSocket and is not in the ServerPool, so
      // branch before any kr.socket / kr.serverKey deref (which assume WS).
      if (kr.info.connectionMode === "zmq") {
        return Promise.resolve({ info: kr.info, wsState: "NONE" });
      }

      const WS_STATE_NAMES = [
        "CONNECTING",
        "OPEN",
        "CLOSING",
        "CLOSED",
      ] as const;
      const wsState = WS_STATE_NAMES[kr.socket!.readyState] ?? "CLOSED";

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
      // Phase 3.9: best-effort mirror cleanup on exit (FR-018). A project
      // mirror loses only its file (the shared `.europa/lsp/` dir survives);
      // an unsaved-notebook mirror drops its whole per-session cache dir.
      await Promise.all(
        sessions
          .filter((s) => s.lspMirror != null)
          .map((s) => cleanupMirrorOnExit(s.lspMirror!).catch(() => {})),
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

    /**
     * Attach to an externally-started kernel via a Jupyter connection file (ZMQ).
     *
     * `:EuropaAttach` is the explicit trigger, so this calls createZmqKernelClient
     * unconditionally (no connection_mode branch, D1). Refuses re-attach onto a
     * buffer that already owns a kernel (server or zmq) to avoid a silent double
     * connection (FR-017 / Q1).
     *
     * @spec-id europa.dispatcher.attach-kernel
     * @spec-id europa.dispatcher.attach-kernel-reject-reattach
     */
    async attachKernel(bufnr: unknown, connectionFile: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `attachKernel: invalid bufnr '${bufnr}'`,
        );
      }
      if (typeof connectionFile !== "string" || connectionFile.length === 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `attachKernel: connectionFile must be a non-empty path`,
        );
      }

      // Policy rejections (no-session, re-attach) and start() failures all run
      // inside the try so each EuropaKernelError surfaces via echomError; an
      // uncaught throw would escape denops.dispatcher and never be shown
      // (codex F001). The catch only echoes — it never touches an existing
      // kernelRuntime, so a re-attach rejection leaves the live connection intact.
      try {
        const session = sessionStore.get(bn);
        if (!session) {
          throw new EuropaKernelError(
            "INVALID_ARGS",
            `attachKernel: bufnr ${bn} has no open notebook session`,
          );
        }
        // FR-017 / Q1: refuse re-attach; keep the existing connection.
        if (session.kernelRuntime) {
          throw new EuropaKernelError(
            "ALREADY_ATTACHED",
            `attachKernel: buffer ${bn} already has a kernel; run :EuropaShutdownKernel first`,
          );
        }
        const config = await loadConfig(denops);
        const createZmq = ctx.createZmqClient ?? createZmqKernelClient;
        const client = createZmq(denops, config, connectionFile);
        // The foreign kernel's true cwd is unknown in pure attach; pass the
        // viewer notebook dir as a best-effort base for traceback jumps (F005).
        const cwd = await denops.call("expand", `#${bn}:p:h`) as string;
        const runtime = await client.start({ kernelName: "", cwd });
        const caps = await detectCapabilities(denops);
        runtime.iopubBatchScheduler = createIopubBatchScheduler({
          denops,
          bufnr: bn,
          getNotebook: () => sessionStore.get(bn)!.notebook,
          caps,
          renderOpts: renderPlanOpts(config),
          onPlanApplied: (plan) => {
            sessionStore.setRenderPlan(bn, plan);
            scheduleHighlightRefresh(ctx, bn);
          },
        });
        sessionStore.update(bn, { kernelRuntime: runtime });
        await echomInfo(
          denops,
          `Attached to kernel (zmq, ${runtime.info.kernelName})`,
        );
      } catch (e) {
        const code = (e instanceof EuropaKernelError) ? ` [${e.code}]` : "";
        await echomError(
          denops,
          `attachKernel failed${code}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },
  };
}
