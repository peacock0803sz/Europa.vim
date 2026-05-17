import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import { EuropaKernelError } from "../kernel/errors.ts";
import { parseNotebook } from "../notebook/parse.ts";
import { serializeNotebook } from "../notebook/serialize.ts";
import { takeStructuralSnapshot } from "../notebook/structural-snapshot.ts";
import { buildRenderPlan } from "../render/builder.ts";
import { setupAutocmds } from "../session/events.ts";
import { applyRenderPlan } from "../view/viewer.ts";
import { defineHighlights } from "../view/highlight.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "./context.ts";
import { processOne } from "./undo.ts";
import { getOrCreateOrchestrator } from "../view/syntax-highlight.ts";
import { scheduleHighlightRefresh } from "./syntax-highlight.ts";

export function buildNotebookDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "init" | "open" | "save" | "cleanup"> {
  const { denops, sessionStore } = ctx;
  return {
    // Phase 2: init - wires highlights, config, capabilities, autocmds.
    async init(): Promise<void> {
      await defineHighlights(denops);
      await loadConfig(denops);
      await detectCapabilities(denops);
      await setupAutocmds(denops);
    },

    /**
     * Clean up all resources for a viewer buffer.
     *
     * @spec-id europa.dispatcher.cleanup-with-scratch
     * @spec-id europa.dispatcher.cleanup-idempotent
     * @spec-id europa.dispatcher.cleanup-with-kernel
     */
    async cleanup(bufnr: unknown): Promise<void> {
      const viewerBufnr = Number(bufnr);
      const session = sessionStore.get(viewerBufnr);
      if (!session) return;

      const kernelShutdown = session.kernelRuntime
        ? session.kernelRuntime.client.shutdown().catch(async (e) => {
          const code = (e instanceof EuropaKernelError) ? ` [${e.code}]` : "";
          await echomError(
            denops,
            `cleanup: kernel shutdown failed${code}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        })
        : Promise.resolve();

      const scratchWipeout = (async () => {
        for (
          const [_cellId, scratchBufnr] of sessionStore.getAllScratchBufnrs(
            viewerBufnr,
          )
        ) {
          const exists = await denops.call("bufexists", scratchBufnr);
          if (exists) {
            await denops.cmd(`bwipeout! ${scratchBufnr}`);
          }
          const group = `europa_cell_edit_${scratchBufnr}`;
          await denops.cmd(`augroup ${group} | autocmd! | augroup END`);
          await denops.cmd(`augroup! ${group}`);
        }
      })();

      await Promise.all([kernelShutdown, scratchWipeout]);
      // Detach syntax highlighter before removing session (FR-003 cleanup)
      const orc = getOrCreateOrchestrator(denops);
      await orc.detach(denops, viewerBufnr).catch(() => {});
      sessionStore.remove(viewerBufnr);
    },

    /**
     * Open a `.ipynb` file, parse it, store the session, and render cells.
     *
     * @spec-id europa.main.open.render
     * @spec-id europa.dispatcher.open-attach-syntax-highlight
     */
    async open(bufnr: unknown, path: unknown): Promise<void> {
      const bufnrNum = Number(bufnr);
      const pathStr = String(path);
      const content = await Deno.readTextFile(pathStr);
      const notebook = await parseNotebook(content);
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = await buildRenderPlan(
        notebook,
        caps,
        renderPlanOpts(config),
      );
      sessionStore.add({
        id: crypto.randomUUID(),
        bufnr: bufnrNum,
        notebookPath: pathStr,
        notebook,
        cellMap: plan.cellMap,
      }, config.undo_max_history);
      sessionStore.get(bufnrNum)!.undoHistory.setProcessor(
        (kind) => processOne(ctx, bufnrNum, kind),
      );
      sessionStore.setRenderPlan(bufnrNum, plan);
      await applyRenderPlan(denops, bufnrNum, plan);
      // Trigger syntax-highlight from here (not ftplugin) to avoid the race
      // where ftplugin's BufRead-time notify lands at denops before this
      // handler has populated the session.
      scheduleHighlightRefresh(ctx, bufnrNum);
    },

    /**
     * Save the open notebook back to disk as canonical JSON.
     *
     * @spec-id europa.dispatcher.save
     */
    async save(bufnr: unknown): Promise<void> {
      const bufnrNum = Number(bufnr);
      const session = sessionStore.get(bufnrNum);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bufnrNum}`);
        return;
      }
      const serialized = serializeNotebook(session.notebook);
      try {
        await Deno.writeTextFile(session.notebookPath, serialized);
        await denops.call("setbufvar", bufnrNum, "&modified", 0);
        sessionStore.update(bufnrNum, {
          lastSavedSnapshot: takeStructuralSnapshot(session.notebook),
        });
      } catch (e) {
        await echomError(
          denops,
          `failed to save notebook: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },
  };
}
