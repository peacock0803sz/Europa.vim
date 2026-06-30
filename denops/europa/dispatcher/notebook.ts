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
import { cleanupMirrorOnExit } from "../lsp/workspace.ts";
import { defineHighlights } from "../view/highlight.ts";
import { registerTracebackPropTypes } from "../view/traceback-jump.ts";
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

  /**
   * Tear down every resource an existing session holds (kernel, scratch
   * buffers, mirror, highlighter) and drop it from the store. Shared by
   * `cleanup` and `open`: `:e` on the viewer re-fires BufReadCmd → `open`,
   * and replacing the session without this teardown would leak the kernel
   * and the on-disk mirror, and leave an orphaned mirror buffer whose stale
   * content could later be re-adopted with the stale guard unset.
   */
  async function teardownSession(viewerBufnr: number): Promise<void> {
    const session = sessionStore.get(viewerBufnr);
    if (!session) return;

    const kernelShutdown = session.kernelRuntime
      ? (async () => {
        // BufWipeout teardown emits frontend-wipeout to comm handlers so
        // widget code can run buffer-bound cleanup before the kernel
        // shuts down. Must precede shutdown() because that disposes the
        // runtime entirely.
        await session.kernelRuntime!.commService?.closeAll("wipeout");
        return session.kernelRuntime!.client.shutdown().catch(async (e) => {
          const code = (e instanceof EuropaKernelError) ? ` [${e.code}]` : "";
          await echomError(
            denops,
            `cleanup: kernel shutdown failed${code}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        });
      })()
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
    // deleteCell / joinCell can drop the mirror's per-cell registrations, so
    // the scratch loop above may miss the mirror buffer: wipe it explicitly,
    // or a later re-open at the same path would re-adopt the stale loaded
    // buffer via bufadd (bufload no-ops when already loaded) with the
    // stale-save guard unset.
    const mirrorBufnr = session.lspMirror?.mirrorBufnr;
    if (mirrorBufnr !== undefined) {
      const mirrorExists = await denops.call("bufexists", mirrorBufnr);
      if (mirrorExists) {
        await denops.cmd(`bwipeout! ${mirrorBufnr}`);
      }
      const group = `europa_cell_edit_${mirrorBufnr}`;
      await denops.cmd(`augroup ${group} | autocmd! | augroup END`);
      await denops.cmd(`augroup! ${group}`);
    }
    // Phase 3.9: remove the notebook mirror if one was materialized
    // (FR-018). cleanupMirrorOnExit removes only the mirror file for a
    // project-placed mirror (the .europa/lsp dir may be shared) but the
    // whole per-session cache dir for an unsaved notebook — the session is
    // dropped below, so atexit could not clean that dir up later.
    if (session.lspMirror) {
      await cleanupMirrorOnExit(session.lspMirror).catch(() => {});
    }
    // Detach syntax highlighter before removing session (FR-003 cleanup)
    const orc = getOrCreateOrchestrator(denops);
    await orc.detach(denops, viewerBufnr).catch(() => {});
    sessionStore.remove(viewerBufnr);
  }

  return {
    // Phase 2: init - wires highlights, config, capabilities, autocmds.
    // registerTracebackPropTypes must run after defineHighlights — the
    // Vim prop_type_add call references the highlight group by name and
    // raises E970 if that group has not been linked yet.
    async init(): Promise<void> {
      await defineHighlights(denops);
      await registerTracebackPropTypes(denops);
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
      await teardownSession(Number(bufnr));
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
      // `:e` on the viewer re-fires BufReadCmd → open for an already-open
      // session: tear the old one down first instead of leaking it.
      await teardownSession(bufnrNum);
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
