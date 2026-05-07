/**
 * @packageDocumentation
 *
 * Europa.vim — Jupyter Notebook viewer and editor for Vim and Neovim.
 *
 * Entry point registered with the Denops runtime. The `main` function wires
 * the Europa RPC dispatcher and is called once when the plugin loads.
 *
 * ## Quick Start
 *
 * Open any `.ipynb` file with `:edit foo.ipynb`. Europa intercepts the read
 * via `BufReadCmd`, parses the notebook, and renders each cell with highlight
 * group decorations. Use `:EuropaPreviewOutput <cellIdx> <outputIdx>` to open
 * image outputs in an external viewer.
 *
 * ### Cell Editing (Phase 3.1)
 *
 * - `:EuropaInsertCell {type}` — insert a new cell (`code`/`markdown`/`raw`)
 * - `:EuropaDeleteCell` — delete the cell at cursor
 * - `:EuropaMoveCellUp` / `:EuropaMoveCellDown` — reorder cells
 * - `:EuropaSplitCell` — split cell at cursor line
 * - `:EuropaJoinCell` — join cell with the one above
 * - `:EuropaEditCell` — open cell source in a scratch buffer for editing
 * - `:EuropaCellType {type}` — change cell type
 *
 * `<Plug>(europa-*)` mappings are defined in `plugin/mappings.vim`.
 * Europa does not install default key mappings — bind them in your ftplugin.
 *
 * ## Phase Coverage
 *
 * - Phase 2: `init`, `save`, `previewOutput`, viewer rendering
 * - Phase 3.1 (this release): `insertCell`, `deleteCell`, `moveCell`,
 *   `splitCell`, `joinCell`, `editCell`, `changeCellType` — full cell
 *   mutation with scratch buffer lifecycle; `saveCellEdit`, `closeCellEdit`,
 *   `lineToCellId` — internal RPCs for scratch buffer wiring
 * - Phase 4+: kernel attach — methods declared but throw `UnimplementedError`
 *
 * @category Commands
 * @category Mappings
 * @module denops/europa/main
 */

import type { Denops } from "@denops/std";
import type { EuropaDispatcher } from "../../contracts/dispatcher.ts";
import type { KernelStatusReport } from "../../schema/session.ts";
import { decodeBase64 } from "@std/encoding/base64";
import { defineHighlights } from "./view/highlight.ts";
import { loadConfig } from "./config.ts";
import type { EuropaConfig } from "../../schema/config.ts";
import { detectCapabilities } from "./capabilities.ts";
import { setupAutocmds } from "./session/events.ts";
import { parseNotebook } from "./notebook/parse.ts";
import { serializeNotebook } from "./notebook/serialize.ts";
import { buildRenderPlan, mergeStreams } from "./render/builder.ts";
import {
  applyRenderPlan,
  closeCellEditAutocmds,
  freezeCellEditBuffer,
  lineToCellId,
  openCellEditBuffer,
  resolveScratchFiletype,
  restoreCursor,
} from "./view/viewer.ts";
import {
  changeCellType,
  deleteCell,
  insertCell,
  joinCell,
  moveCell,
  splitCell,
  updateCellSource,
} from "./notebook/cell.ts";
import { SessionStore } from "./session/state.ts";
import { createKernelClient } from "./kernel/client.ts";
import { EuropaKernelError } from "./kernel/errors.ts";
import { ServerPool } from "./kernel/server-pool.ts";
import {
  cancelQueued,
  complete,
  enqueue,
  markSent,
} from "./session/pending-requests.ts";
import {
  applyMessageToCell,
  execute as kernelExecute,
} from "./kernel/execute.ts";
import type { CodeCell } from "../../schema/notebook.ts";

/** Thrown by Phase 3+ dispatcher methods that are not yet implemented. */
export class UnimplementedError extends Error {
  constructor(method: string) {
    super(`UnimplementedError: ${method} is not implemented in Phase 2`);
    this.name = "UnimplementedError";
  }
}

/** Image MIME types supported by `:EuropaPreviewOutput`, in priority order. */
const IMAGE_MIMES = ["image/png", "image/jpeg"] as const;
type ImageMime = typeof IMAGE_MIMES[number];

/** Map image MIME to a file suffix for the temp file. */
const MIME_SUFFIX: Record<ImageMime, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

/** Wrap a string as a Vimscript single-quoted literal, escaping ' by doubling. */
function vimSingleQuote(s: string): string {
  return "'" + s.replace(/\r\n?/g, "\n").replace(/\n/g, "\\n").replace(
    /'/g,
    "''",
  ) + "'";
}

/**
 * Emit an error message to Vim's `:messages` without throwing.
 * Uses `echohl ErrorMsg` so the message appears in red.
 */
async function echomError(denops: Denops, reason: string): Promise<void> {
  await denops.cmd(
    `echohl ErrorMsg | echom ${
      vimSingleQuote(`Europa: ${reason}`)
    } | echohl None`,
  );
}

function renderPlanOpts(config: EuropaConfig) {
  return {
    maxOutputLines: config.max_output_lines,
    cellBorderChars: config.cell_border_chars,
    cellBorderPadding: config.cell_border_padding,
    cellBorderAlign: config.cell_border_align,
  };
}

/**
 * Build the Europa RPC dispatcher record.
 *
 * Returns an object whose shape satisfies `EuropaDispatcher`. The factory is
 * separate from `main` so tests can import and verify the dispatcher shape
 * without a live Vim process.
 *
 * @param denops - Denops instance for issuing Vim commands.
 * @returns Dispatcher record registered as `denops.dispatcher`.
 * @spec-id europa.contract.dispatcher-alignment
 * @spec-id europa.dispatcher.preview-output
 * @spec-id europa.commands.preview-output
 * @spec-id europa.contract.dispatcher-phase3-1-alignment
 * @spec-id europa.contract.dispatcher-phase3-2-alignment
 */
export function buildDispatcher(denops: Denops): EuropaDispatcher {
  const sessionStore = new SessionStore();
  const serverPool = new ServerPool();

  /**
   * Refuse a structural mutation when the cell's scratch edit buffer has
   * unsaved changes.
   *
   * Both splitCell and joinCell rebuild source from `session.notebook`,
   * so a dirty scratch's typed-but-not-saved content would otherwise be
   * silently overwritten when we rewrite the scratch with the new
   * upper-half / merged source. Refusing here matches Vim convention
   * (`:bdelete` etc. refuse on dirty buffers) and lets the user choose
   * `:write` (commit edits) or `:bdelete` (discard them) explicitly.
   *
   * @returns `true` when refused (caller should return immediately —
   *   guidance has already been emitted); `false` when safe to proceed.
   */
  async function refuseIfScratchDirty(
    viewerBufnr: number,
    cellId: string,
  ): Promise<boolean> {
    const sbn = sessionStore.getScratchBufnr(viewerBufnr, cellId);
    if (sbn === undefined) return false;
    const exists = await denops.call("bufexists", sbn);
    if (!exists) return false;
    const modified = await denops.call("getbufvar", sbn, "&modified");
    if (modified !== 1 && modified !== "1") return false;
    await denops.cmd(
      `echohl WarningMsg | echom ${
        vimSingleQuote(
          `Europa: cell ${cellId} has unsaved scratch edits — :write or :bdelete __europa_cell_${cellId}__ first`,
        )
      } | echohl None`,
    );
    return true;
  }

  return {
    // Phase 2: init — wires highlights, config, capabilities, autocmds
    async init(): Promise<void> {
      await defineHighlights(denops);
      await loadConfig(denops);
      await detectCapabilities(denops);
      await setupAutocmds(denops);
    },

    /**
     * Clean up all resources for a viewer buffer.
     *
     * If a kernel is attached, initiates shutdown in parallel with the scratch
     * buffer wipeout. Shutdown failures emit a warning but do not halt the
     * broader cleanup. Idempotent: if the session is already gone
     * (e.g. BufUnload fired before BufWipeout) the call is a no-op.
     *
     * @spec-id europa.dispatcher.cleanup-with-scratch
     * @spec-id europa.dispatcher.cleanup-idempotent
     * @spec-id europa.dispatcher.cleanup-with-kernel
     */
    async cleanup(bufnr: unknown): Promise<void> {
      const viewerBufnr = Number(bufnr);
      const session = sessionStore.get(viewerBufnr);
      if (!session) return;

      // Fire kernel shutdown and scratch wipeout in parallel.
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
      sessionStore.remove(viewerBufnr);
    },

    /**
     * Open a `.ipynb` file, parse it, store the session, and render cells.
     *
     * Called by the `BufReadCmd *.ipynb` autocmd via `denops#notify`. Stores
     * a `Session` in `SessionStore` so `previewOutput` can look up the
     * notebook later without re-reading from disk.
     *
     * @spec-id europa.main.open.render
     */
    async open(bufnr: unknown, path: unknown): Promise<void> {
      const bufnrNum = Number(bufnr);
      const pathStr = String(path);
      const content = await Deno.readTextFile(pathStr);
      const notebook = await parseNotebook(content);
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(notebook, caps, renderPlanOpts(config));
      sessionStore.add({
        id: crypto.randomUUID(),
        bufnr: bufnrNum,
        notebookPath: pathStr,
        notebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bufnrNum, plan);
      await applyRenderPlan(denops, bufnrNum, plan);
    },

    /**
     * Save the open notebook back to disk as canonical JSON.
     *
     * Reads the session's stored `Notebook`, serializes it with
     * {@link serializeNotebook} (1-space indent, trailing LF), and writes
     * it to `session.notebookPath`. On success, clears the modified flag.
     * On failure, reports via `:messages`.
     *
     * @param bufnr - Buffer number of the open notebook.
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
      } catch (e) {
        await echomError(
          denops,
          `failed to save notebook: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },

    /**
     * Open an image cell output in the OS default external viewer.
     *
     * Looks up the session, extracts the image MIME data from the specified
     * output, writes it to a temp file, and launches the platform viewer.
     * All errors are reported via `:messages` without throwing.
     *
     * @param bufnr - Buffer number of the open notebook.
     * @param cellIdx - Zero-based index into `notebook.cells[]`.
     * @param outputIdx - Zero-based index into `cell.outputs[]` after stream merging.
     */
    async previewOutput(
      bufnr: unknown,
      cellIdx: unknown,
      outputIdx: unknown,
    ): Promise<void> {
      const bufnrNum = Number(bufnr);
      const cellIdxNum = Number(cellIdx);
      const outputIdxNum = Number(outputIdx);

      const session = sessionStore.get(bufnrNum);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bufnrNum}`);
        return;
      }

      const cell = session.notebook.cells[cellIdxNum];
      if (!cell) {
        await echomError(denops, `cell index ${cellIdxNum} out of range`);
        return;
      }

      if (cell.cell_type !== "code") {
        await echomError(
          denops,
          "preview only available for code cell outputs",
        );
        return;
      }

      // Use mergeStreams to align with the indices embedded in placeholders
      // by buildRenderPlan, which also runs mergeStreams before dispatching.
      const outputs = mergeStreams(cell.outputs ?? []);
      const output = outputs[outputIdxNum];
      if (!output) {
        await echomError(denops, `output index ${outputIdxNum} out of range`);
        return;
      }

      if (
        output.output_type !== "display_data" &&
        output.output_type !== "execute_result"
      ) {
        await echomError(
          denops,
          "preview only available for display_data or execute_result outputs",
        );
        return;
      }

      const data = output.data as Record<string, unknown>;
      const selectedMime = IMAGE_MIMES.find(
        (m) => typeof data[m] === "string",
      );
      if (!selectedMime) {
        await echomError(denops, "no image/png or image/jpeg in output data");
        return;
      }

      let decoded: Uint8Array;
      try {
        decoded = decodeBase64(data[selectedMime] as string);
      } catch {
        await echomError(denops, "failed to decode base64 image data");
        return;
      }

      let tempPath: string;
      try {
        tempPath = await Deno.makeTempFile({
          suffix: MIME_SUFFIX[selectedMime],
        });
        await Deno.writeFile(tempPath, decoded);
      } catch {
        await echomError(denops, "failed to write image to temp file");
        return;
      }

      try {
        const os = Deno.build.os;
        let cmd: string;
        let args: string[];
        if (os === "darwin") {
          cmd = "open";
          args = [tempPath];
        } else if (os === "linux") {
          cmd = "xdg-open";
          args = [tempPath];
        } else if (os === "windows") {
          cmd = "cmd";
          args = ["/c", "start", "", tempPath];
        } else {
          await echomError(
            denops,
            `unsupported OS '${os}' — open ${tempPath} manually`,
          );
          return;
        }
        const result = await new Deno.Command(cmd, { args }).output();
        if (result.code !== 0) {
          const stderrText = result.stderr.length > 0
            ? new TextDecoder().decode(result.stderr).trim()
            : "";
          await echomError(
            denops,
            stderrText
              ? `failed to launch external image viewer (exit ${result.code}): ${stderrText}`
              : `failed to launch external image viewer (exit ${result.code})`,
          );
        }
      } catch {
        await echomError(denops, "failed to launch external image viewer");
      }
    },

    /**
     * Insert a new empty cell adjacent to the anchor cell.
     *
     * Validates arguments, mutates the notebook immutably via `cell.ts`,
     * commits to SessionStore, rebuilds and applies the RenderPlan, and
     * restores the cursor to the newly inserted cell.
     *
     * @spec-id europa.dispatcher.insert-cell
     */
    async insertCell(
      bufnr: unknown,
      type: unknown,
      position: unknown,
      anchorCellId: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `insertCell: no session for buffer ${bn}`);
        return;
      }
      const validTypes = ["code", "markdown", "raw"] as const;
      const validPositions = ["before", "after"] as const;
      const typeStr = String(type);
      const posStr = String(position);
      if (!validTypes.includes(typeStr as typeof validTypes[number])) {
        await echomError(denops, `insertCell: invalid type '${typeStr}'`);
        return;
      }
      if (!validPositions.includes(posStr as typeof validPositions[number])) {
        await echomError(denops, `insertCell: invalid position '${posStr}'`);
        return;
      }
      const anchorId = anchorCellId == null ? null : String(anchorCellId);
      if (
        (anchorId === null || anchorId === "") &&
        session.notebook.cells.length > 0
      ) {
        await echomError(
          denops,
          "insertCell: no cell at cursor; cannot resolve anchor",
        );
        return;
      }
      const prePlan = sessionStore.getRenderPlan(bn);
      const preCellRanges = prePlan?.cellRanges ?? [];
      const winid = await denops.call("bufwinid", bn) as number;
      const cursorPos = winid > 0
        ? await denops.call("getcurpos", winid) as number[]
        : [0, 1, 0, 0, 0];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);
      let newNotebook: typeof session.notebook;
      let newCellId: string;
      try {
        const result = insertCell(
          session.notebook,
          posStr as "before" | "after",
          typeStr as "code" | "markdown" | "raw",
          anchorId === "" ? null : anchorId,
        );
        newNotebook = result.notebook;
        newCellId = result.cellId;
      } catch (e) {
        await echomError(
          denops,
          `insertCell: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(bn, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bn, plan);
      try {
        await applyRenderPlan(denops, bn, plan);
        await denops.call("setbufvar", bn, "&modified", 1);
      } catch {
        await echomError(denops, "insertCell: applyRenderPlan failed");
      }
      await restoreCursor(
        denops,
        winid,
        preCellId,
        preCellRanges,
        plan.cellRanges,
        {
          preferCellId: newCellId,
        },
      );
    },

    /**
     * Delete the cell with the given id from the notebook.
     *
     * Validates the session, removes the cell immutably, commits to
     * SessionStore, rebuilds the RenderPlan, and restores the cursor.
     * If `cellId` is not found, emits a warning and returns without mutation.
     *
     * @spec-id europa.dispatcher.delete-cell
     */
    async deleteCell(bufnr: unknown, cellId: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `deleteCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const prePlan = sessionStore.getRenderPlan(bn);
      const preCellRanges = prePlan?.cellRanges ?? [];
      const winid = await denops.call("bufwinid", bn) as number;
      const cursorPos = winid > 0
        ? await denops.call("getcurpos", winid) as number[]
        : [0, 1, 0, 0, 0];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);
      const newNotebook = deleteCell(session.notebook, cid);
      if (Object.is(newNotebook, session.notebook)) {
        await echomError(denops, `deleteCell: cell '${cid}' not found`);
        return;
      }
      // Clean up any open scratch buffer for the deleted cell. The
      // augroup must be cleared here, not in closeCellEdit: once we
      // remove the session entry, a later BufWipeout cannot reverse-
      // look up the cellId and would leave the autocmd group leaking.
      const scratchBufnr = sessionStore.getScratchBufnr(bn, cid);
      if (scratchBufnr !== undefined) {
        const exists = await denops.call("bufexists", scratchBufnr);
        if (exists) {
          await denops.call("setbufvar", scratchBufnr, "&modifiable", 1);
          await denops.call(
            "appendbufline",
            scratchBufnr,
            "$",
            "[Cell deleted from notebook]",
          );
          await denops.call("setbufvar", scratchBufnr, "&modifiable", 0);
          await denops.call("setbufvar", scratchBufnr, "&modified", 0);
          await denops.call("setbufvar", scratchBufnr, "&buftype", "nofile");
        }
        await closeCellEditAutocmds(denops, scratchBufnr);
        sessionStore.removeCellEditBuffer(bn, cid);
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(bn, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bn, plan);
      try {
        await applyRenderPlan(denops, bn, plan);
        await denops.call("setbufvar", bn, "&modified", 1);
      } catch {
        await echomError(denops, "deleteCell: applyRenderPlan failed");
      }
      await restoreCursor(
        denops,
        winid,
        preCellId,
        preCellRanges,
        plan.cellRanges,
      );
    },
    /**
     * Swap a cell with its neighbour above (`up`) or below (`down`).
     *
     * Validates arguments, delegates to the pure `moveCell` helper, and uses
     * `Object.is` to detect boundary no-ops — the helper returns the same
     * notebook reference when moving the first cell up, the last cell down,
     * or when the cellId is unknown. In those cases the dispatcher surfaces
     * a user-facing guidance message via `:messages` and skips both the
     * SessionStore commit and the re-render so unrelated buffers aren't
     * needlessly marked dirty.
     *
     * On a real move, the cellId binding survives across the swap, so the
     * cursor restore prefers the original cell's new `startLine`. Any open
     * scratch edit buffer is keyed by cellId and therefore needs no
     * touch-up here (R5).
     *
     * @spec-id europa.dispatcher.move-cell
     */
    async moveCell(
      bufnr: unknown,
      cellId: unknown,
      direction: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `moveCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const validDirections = ["up", "down"] as const;
      const dirStr = String(direction);
      if (!validDirections.includes(dirStr as typeof validDirections[number])) {
        await echomError(denops, `moveCell: invalid direction '${dirStr}'`);
        return;
      }
      const dir = dirStr as "up" | "down";
      const idx = session.notebook.cells.findIndex((c) => c.id === cid);
      if (idx === -1) {
        await echomError(denops, `moveCell: cell '${cid}' not found`);
        return;
      }
      const newNotebook = moveCell(session.notebook, cid, dir);
      if (Object.is(newNotebook, session.notebook)) {
        const guidance = dir === "up" ? "Already at top" : "Already at bottom";
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote(`Europa: ${guidance}`)
          } | echohl None`,
        );
        return;
      }
      const prePlan = sessionStore.getRenderPlan(bn);
      const preCellRanges = prePlan?.cellRanges ?? [];
      const winid = await denops.call("bufwinid", bn) as number;
      const cursorPos = winid > 0
        ? await denops.call("getcurpos", winid) as number[]
        : [0, 1, 0, 0, 0];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(bn, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bn, plan);
      try {
        await applyRenderPlan(denops, bn, plan);
        await denops.call("setbufvar", bn, "&modified", 1);
      } catch {
        await echomError(denops, "moveCell: applyRenderPlan failed");
      }
      await restoreCursor(
        denops,
        winid,
        preCellId,
        preCellRanges,
        plan.cellRanges,
        { preferCellId: cid },
      );
    },
    /**
     * Split the cell at the given line into two consecutive cells.
     *
     * `bufnr` may be either the viewer or one of its scratch edit buffers.
     * `findViewerByScratchBufnr` decides which path: scratch callers pass
     * `line` as a direct 1-origin source row (line - 1 = splitLine), while
     * viewer callers go through cellRange geometry — the cursor snaps to
     * splitLine 0 if it lands on the boundary header, and to
     * `sourceLineCount` if it lands on an output line past the source. The
     * branching lives here (not in autoload) so `:EuropaSplitCell` works
     * uniformly from both contexts (Codex review H2-r2).
     *
     * After commit, the upper cell keeps the original cellId and outputs;
     * if a scratch edit buffer is open for that cellId, its contents are
     * trimmed to the upper-half source so the user's editing context
     * stays consistent with the notebook.
     *
     * @spec-id europa.dispatcher.split-cell
     */
    async splitCell(
      bufnr: unknown,
      cellId: unknown,
      line: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const cid = String(cellId);
      const ln = Number(line);
      if (!Number.isInteger(ln) || ln < 1) {
        await echomError(denops, `splitCell: invalid line '${line}'`);
        return;
      }

      // Dispatch viewer vs scratch here so the autoload helper can pass
      // bufnr('%') raw (Codex H2-r2 contract decision).
      const reverseLookup = sessionStore.findViewerByScratchBufnr(bn);
      let viewerBufnr: number;
      let splitLine: number;
      if (reverseLookup) {
        viewerBufnr = reverseLookup.viewerBufnr;
        if (reverseLookup.cellId !== cid) {
          await echomError(
            denops,
            `splitCell: scratch buffer ${bn} does not own cell '${cid}'`,
          );
          return;
        }
        splitLine = ln - 1;
      } else {
        viewerBufnr = bn;
        const session = sessionStore.get(viewerBufnr);
        if (!session) {
          await echomError(denops, `splitCell: no session for buffer ${bn}`);
          return;
        }
        const cell = session.notebook.cells.find((c) => c.id === cid);
        if (!cell) {
          await echomError(denops, `splitCell: cell '${cid}' not found`);
          return;
        }
        const plan = sessionStore.getRenderPlan(viewerBufnr);
        const range = plan?.cellRanges.find((r) => r.cellId === cid);
        if (!range) {
          await echomError(
            denops,
            `splitCell: no render plan range for cell '${cid}'`,
          );
          return;
        }
        const userLine0 = ln - 1;
        const sourceStart = range.startLine + 1;
        const sourceLineCount = cell.source.split("\n").length;
        const sourceEnd = sourceStart + sourceLineCount - 1;
        if (userLine0 < sourceStart) {
          splitLine = 0;
        } else if (userLine0 > sourceEnd) {
          splitLine = sourceLineCount;
        } else {
          splitLine = userLine0 - sourceStart;
        }
      }

      const session = sessionStore.get(viewerBufnr);
      if (!session) {
        await echomError(
          denops,
          `splitCell: no session for viewer buffer ${viewerBufnr}`,
        );
        return;
      }
      if (await refuseIfScratchDirty(viewerBufnr, cid)) return;
      const prePlan = sessionStore.getRenderPlan(viewerBufnr);
      const preCellRanges = prePlan?.cellRanges ?? [];
      const winid = await denops.call("bufwinid", viewerBufnr) as number;
      const cursorPos = winid > 0
        ? await denops.call("getcurpos", winid) as number[]
        : [0, 1, 0, 0, 0];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);

      let newNotebook: typeof session.notebook;
      try {
        newNotebook = splitCell(session.notebook, cid, splitLine);
      } catch (e) {
        await echomError(
          denops,
          `splitCell: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(viewerBufnr, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(viewerBufnr, plan);
      try {
        await applyRenderPlan(denops, viewerBufnr, plan);
        await denops.call("setbufvar", viewerBufnr, "&modified", 1);
      } catch {
        await echomError(denops, "splitCell: applyRenderPlan failed");
      }

      // Rewrite the upper cell's scratch with the trimmed source. The
      // bufexists guard matches deleteCell — BufWipeout cleanup is async
      // (denops#notify), so the session map can briefly hold a stale
      // bufnr that would otherwise throw on deletebufline / setbufline.
      const scratchBufnr = sessionStore.getScratchBufnr(viewerBufnr, cid);
      if (scratchBufnr !== undefined) {
        const exists = await denops.call("bufexists", scratchBufnr);
        if (exists) {
          const upperCell = newNotebook.cells.find((c) => c.id === cid);
          if (upperCell) {
            const upperLines = upperCell.source.split("\n");
            await denops.call("deletebufline", scratchBufnr, 1, "$");
            await denops.call("setbufline", scratchBufnr, 1, upperLines);
            await denops.call("setbufvar", scratchBufnr, "&modified", 0);
          }
        }
      }

      await restoreCursor(
        denops,
        winid,
        preCellId,
        preCellRanges,
        plan.cellRanges,
        { preferCellId: cid },
      );
    },
    /**
     * Merge the target cell into the cell immediately above it.
     *
     * The previous cell's identity (`id` / `cell_type` / outputs /
     * `execution_count` / `metadata`) wins; the target cell is removed.
     *
     * Boundary handling differs by cause and is reflected in the
     * `:messages` color so users can distinguish input mistakes from
     * intentional no-ops:
     * - First cell (target idx 0): `WarningMsg` "No cell above to join"
     *   — a soft no-op the user can recover from by moving the cursor.
     * - Unknown cellId: `ErrorMsg` "joinCell: cell '<id>' not found" —
     *   a hard error indicating a bug in the caller (autoload / mapping)
     *   or a stale RPC argument.
     * In both cases the SessionStore is left untouched.
     *
     * Two scratch buffers may need touch-ups: the absorbed (target)
     * scratch is frozen and its session entry removed, while the
     * surviving (previous) scratch — if open — gets its contents
     * rewritten to the joined source so the user keeps editing the
     * combined cell without confusion.
     *
     * @spec-id europa.dispatcher.join-cell
     */
    async joinCell(bufnr: unknown, cellId: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `joinCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const idx = session.notebook.cells.findIndex((c) => c.id === cid);
      if (idx === -1) {
        await echomError(denops, `joinCell: cell '${cid}' not found`);
        return;
      }
      if (idx === 0) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: No cell above to join")
          } | echohl None`,
        );
        return;
      }
      const prevCellId = session.notebook.cells[idx - 1].id;
      // Both halves of the join read source from session.notebook, so
      // unsaved scratch edits on either side would be silently dropped
      // when we rewrite the surviving scratch / freeze the absorbed one.
      if (await refuseIfScratchDirty(bn, cid)) return;
      if (await refuseIfScratchDirty(bn, prevCellId)) return;
      const prePlan = sessionStore.getRenderPlan(bn);
      const preCellRanges = prePlan?.cellRanges ?? [];
      const winid = await denops.call("bufwinid", bn) as number;
      const cursorPos = winid > 0
        ? await denops.call("getcurpos", winid) as number[]
        : [0, 1, 0, 0, 0];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);
      const newNotebook = joinCell(session.notebook, cid);
      if (Object.is(newNotebook, session.notebook)) {
        // Already caught by the first-cell guard above; defensive no-op.
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(bn, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bn, plan);
      try {
        await applyRenderPlan(denops, bn, plan);
        await denops.call("setbufvar", bn, "&modified", 1);
      } catch {
        await echomError(denops, "joinCell: applyRenderPlan failed");
      }

      // Freeze the target cell's scratch buffer and drop it from the
      // session map so future :EuropaEditCell on this cellId starts fresh.
      // Augroup is cleared synchronously here for the same reason as
      // deleteCell — once the session entry is gone, closeCellEdit can
      // no longer locate the cellId on a later BufWipeout.
      const targetScratchBufnr = sessionStore.getScratchBufnr(bn, cid);
      if (targetScratchBufnr !== undefined) {
        const exists = await denops.call("bufexists", targetScratchBufnr);
        if (exists) {
          await freezeCellEditBuffer(denops, targetScratchBufnr, cid);
        }
        await closeCellEditAutocmds(denops, targetScratchBufnr);
        sessionStore.removeCellEditBuffer(bn, cid);
      }
      // Rewrite the surviving (previous) cell's scratch with the joined
      // source. The bufexists guard mirrors splitCell to avoid throws on
      // a session map that briefly outlives the underlying scratch buffer.
      const survivingScratchBufnr = sessionStore.getScratchBufnr(
        bn,
        prevCellId,
      );
      if (survivingScratchBufnr !== undefined) {
        const survivingExists = await denops.call(
          "bufexists",
          survivingScratchBufnr,
        );
        if (survivingExists) {
          const merged = newNotebook.cells.find((c) => c.id === prevCellId);
          if (merged) {
            const mergedLines = merged.source.split("\n");
            await denops.call("deletebufline", survivingScratchBufnr, 1, "$");
            await denops.call(
              "setbufline",
              survivingScratchBufnr,
              1,
              mergedLines,
            );
            await denops.call(
              "setbufvar",
              survivingScratchBufnr,
              "&modified",
              0,
            );
          }
        }
      }

      await restoreCursor(
        denops,
        winid,
        preCellId,
        preCellRanges,
        plan.cellRanges,
        { preferCellId: prevCellId },
      );
    },
    /**
     * Open (or focus) a scratch buffer to edit a single cell's source.
     *
     * Looks up the cell, resolves the scratch buffer's filetype from the
     * notebook's kernel metadata, hands a complete options bag to the
     * pure host I/O `openCellEditBuffer`, and registers the resulting
     * scratch bufnr in `cellEditBuffers` so subsequent edits / saves /
     * cleanups can find their way back to the cell.
     *
     * Calling editCell again for the same cellId reuses the existing
     * scratch bufnr — the user gets a `:buffer N` focus instead of a
     * fresh split (FR-020).
     *
     * @spec-id europa.dispatcher.edit-cell
     */
    async editCell(bufnr: unknown, cellId: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `editCell: no session for buffer ${bn}`);
        return;
      }
      const cid = String(cellId);
      const cell = session.notebook.cells.find((c) => c.id === cid);
      if (!cell) {
        await echomError(denops, `editCell: cell '${cid}' not found`);
        return;
      }
      const filetype = resolveScratchFiletype(session.notebook, cell);
      const sourceLines = cell.source.split("\n");
      const existing = sessionStore.getScratchBufnr(bn, cid);
      const scratchBufnr = await openCellEditBuffer(denops, {
        bufname: `__europa_cell_${cid}__`,
        cellId: cid,
        viewerBufnr: bn,
        sourceLines,
        filetype,
        existingScratchBufnr: existing,
      });
      sessionStore.setCellEditBuffer(bn, cid, scratchBufnr);
    },
    /**
     * Change a cell's type and update the viewer and any open scratch buffer.
     *
     * Field transitions (per contract):
     * - code → markdown / raw: drops `outputs` / `execution_count`.
     * - markdown / raw → code: initialises `outputs = []` / `execution_count = null`.
     * - same-type: no-op (returns early without mutating state).
     *
     * When a scratch buffer is open for the cell, its `&filetype` is updated to
     * match the new type so the user's editor mode stays in sync (FR-023).
     *
     * @spec-id europa.dispatcher.change-cell-type
     */
    async changeCellType(
      bufnr: unknown,
      cellId: unknown,
      newType: unknown,
    ): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `changeCellType: no session for buffer ${bn}`);
        return;
      }
      const validTypes = ["code", "markdown", "raw"] as const;
      const typeStr = String(newType);
      if (!validTypes.includes(typeStr as typeof validTypes[number])) {
        await echomError(
          denops,
          `changeCellType: invalid type '${typeStr}'; must be code, markdown, or raw`,
        );
        return;
      }
      const nt = typeStr as "code" | "markdown" | "raw";
      const cid = String(cellId);
      // Explicit existence check: changeCellType returns the same reference
      // for both "same-type no-op" and "cellId not found", so Object.is alone
      // cannot distinguish the two — a missing cellId would silently do nothing.
      const cellExists = session.notebook.cells.some((c) => c.id === cid);
      if (!cellExists) {
        await echomError(denops, `changeCellType: cell '${cid}' not found`);
        return;
      }
      const newNotebook = changeCellType(session.notebook, cid, nt);
      if (Object.is(newNotebook, session.notebook)) {
        // same-type no-op; nothing to do
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(bn, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(bn, plan);
      try {
        await applyRenderPlan(denops, bn, plan);
        await denops.call("setbufvar", bn, "&modified", 1);
      } catch {
        await echomError(denops, "changeCellType: applyRenderPlan failed");
      }
      // Update scratch buffer filetype to match the new cell type (FR-023).
      const scratchBufnr = sessionStore.getScratchBufnr(bn, cid);
      if (scratchBufnr !== undefined) {
        const scratchExists = await denops.call("bufexists", scratchBufnr);
        if (scratchExists) {
          const newCell = newNotebook.cells.find((c) => c.id === cid);
          if (newCell) {
            const newFiletype = resolveScratchFiletype(newNotebook, newCell);
            await denops.call(
              "setbufvar",
              scratchBufnr,
              "&filetype",
              newFiletype,
            );
          }
        }
      }
    },
    /**
     * Commit a scratch buffer's contents back into the in-memory notebook.
     *
     * Triggered by the scratch buffer's `BufWriteCmd` autocmd. Reverse
     * looks up the viewer bufnr / cellId for `scratchBufnr`, reads the
     * current scratch lines, replaces the cell's source, rebuilds and
     * applies the RenderPlan, marks the viewer dirty so the user knows
     * the notebook has unsaved changes, and clears the scratch's modified
     * flag so `:write` reports success.
     *
     * Disk persistence is deferred to `:write` on the viewer buffer
     * (FR-035) — saveCellEdit only mutates in-memory state.
     *
     * @spec-id europa.dispatcher.save-cell-edit
     */
    async saveCellEdit(scratchBufnr: unknown): Promise<void> {
      const sbn = Number(scratchBufnr);
      const lookup = sessionStore.findViewerByScratchBufnr(sbn);
      if (!lookup) return;
      const session = sessionStore.get(lookup.viewerBufnr);
      if (!session) return;
      const lines = await denops.call(
        "getbufline",
        sbn,
        1,
        "$",
      ) as string[];
      const newSource = lines.join("\n");
      const newNotebook = updateCellSource(
        session.notebook,
        lookup.cellId,
        newSource,
      );
      // updateCellSource returns the input notebook reference when the
      // cellId is gone. Surface that as a save failure rather than
      // silently clearing the scratch's modified flag and pretending
      // the write succeeded.
      if (Object.is(newNotebook, session.notebook)) {
        await echomError(
          denops,
          `saveCellEdit: cell '${lookup.cellId}' is no longer in the notebook; edit was not applied`,
        );
        return;
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, renderPlanOpts(config));
      sessionStore.update(lookup.viewerBufnr, {
        notebook: newNotebook,
        cellMap: plan.cellMap,
      });
      sessionStore.setRenderPlan(lookup.viewerBufnr, plan);
      try {
        await applyRenderPlan(denops, lookup.viewerBufnr, plan);
        await denops.call(
          "setbufvar",
          lookup.viewerBufnr,
          "&modified",
          1,
        );
      } catch {
        await echomError(denops, "saveCellEdit: applyRenderPlan failed");
      }
      await denops.call("setbufvar", sbn, "&modified", 0);
    },
    /**
     * Tear down session state for a wiped scratch buffer.
     *
     * Triggered by the scratch buffer's `BufWipeout` autocmd. Removes the
     * cellId entry from `cellEditBuffers` and clears the per-scratch
     * autocmd group so stale autocmds do not fire after the buffer is
     * gone. Idempotent — unknown scratch bufnrs are a no-op.
     *
     * @spec-id europa.dispatcher.close-cell-edit
     */
    async closeCellEdit(scratchBufnr: unknown): Promise<void> {
      const sbn = Number(scratchBufnr);
      const lookup = sessionStore.findViewerByScratchBufnr(sbn);
      if (!lookup) return;
      sessionStore.removeCellEditBuffer(lookup.viewerBufnr, lookup.cellId);
      await closeCellEditAutocmds(denops, sbn);
    },
    /**
     * Resolve a 1-origin viewer buffer line number to the cell id containing it.
     *
     * Reads the most recently cached `RenderPlan` from `SessionStore` so the
     * call is synchronous after the initial render — no re-parse needed.
     *
     * @spec-id europa.dispatcher.line-to-cellid
     */
    lineToCellId(
      bufnr: unknown,
      line: unknown,
    ): Promise<string | null> {
      const bn = Number(bufnr);
      const ln = Number(line);
      const plan = sessionStore.getRenderPlan(bn);
      if (!plan) return Promise.resolve(null);
      return Promise.resolve(lineToCellId(plan.cellRanges, ln));
    },

    // Phase 3.2: kernel lifecycle methods
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
     * Idempotent: calling on a buffer with no active kernel is a no-op.
     *
     * @spec-id europa.dispatcher.shutdown-kernel
     */
    async shutdownKernel(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session?.kernelRuntime) return;
      const { client } = session.kernelRuntime;
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
     * Reads the live WebSocket readyState, the KernelInfo stored in
     * SessionStore, and the serverPool refcount. No RPC to the kernel is
     * made — this is a pure local state read.
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
     * Called via VimLeavePre autocmd. Iterates all sessions and calls
     * client.shutdown() in parallel, then calls serverPool.killAll().
     *
     * @spec-id europa.dispatcher.atexit
     */
    async atexit(): Promise<void> {
      const sessions = sessionStore.all();
      await Promise.all(
        sessions
          .filter((s) => s.kernelRuntime != null)
          .map(async (s) => {
            try {
              await s.kernelRuntime!.client.shutdown();
            } catch { /* shutdown errors during exit are best-effort */ }
          }),
      );
      await serverPool.killAll();
    },

    // @spec-id europa.contract.dispatcher-phase3-3-alignment
    // @spec-id europa.dispatcher.run-cell
    // @spec-id europa.dispatcher.run-cell-queued-on-busy
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

      // Cell was previously queued (runCell called while kernel was busy)
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
        // execState=idle: find existing queued entry to re-dispatch (FR-003 no double-enqueue)
        for (const [msgId, entry] of kr.pendingRequests.entries()) {
          if (entry.cellId === cellId && entry.state === "queued") {
            redispatchMsgId = msgId;
            break;
          }
        }
        if (!redispatchMsgId) {
          // Stale cellState with no matching entry — reset and fall through to fresh enqueue
          kr.cellStates.set(cellId, "idle");
        }
      }

      // FR-008: kernel busy and cell not yet queued → enqueue without dispatching
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

      // Snapshot source at call time (Q-edit / FR-002)
      const code = codeCell.source;

      // Re-dispatch queued entry or fresh enqueue — either way msgId is the Jupyter msg_id
      const msgId = redispatchMsgId ?? enqueue(kr, bn, cellId);

      // Clear outputs only when we are actually about to send the request
      codeCell.outputs = [];
      kr.execState = "busy";
      markSent(kr, msgId);
      // Capture signal at dispatch time so restart/interrupt can abort this
      // specific execute via runtime.abort.abort() (FR-012).
      const execSignal = kr.abort.signal;
      try {
        for await (
          const msg of kernelExecute(kr, code, { msgId, signal: execSignal })
        ) {
          applyMessageToCell(codeCell, msg);
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
        // Guard against clobbering "restarting" set by a concurrent restartKernel (FR-011).
        if (kr.execState === "busy") kr.execState = "idle";
        // Full re-render once execution completes (incremental rendering is Phase 5+)
        try {
          const config = await loadConfig(denops);
          const caps = await detectCapabilities(denops);
          const plan = buildRenderPlan(
            session!.notebook,
            caps,
            renderPlanOpts(config),
          );
          sessionStore.setRenderPlan(bn, plan);
          await applyRenderPlan(denops, bn, plan);
        } catch {
          // Re-render failure is non-fatal
        }
      }
    },
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
      const markdownSkipped = allCells.length - codeCells.length;

      // Phase 1: pre-enqueue all code cells.
      // Reuse any existing queued entry left by a prior runCell call to avoid
      // leaving ghost requests in pendingRequests.
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

      // Phase 2: sequential execution
      kr.execState = "busy";
      let completed = 0;
      let cancelledSkipped = 0;
      let errorStopped = false;
      const totalCode = codeCells.length;

      try {
        for (const { cell, msgId } of entries) {
          // Check if cancelled
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
          try {
            for await (
              const msg of kernelExecute(kr, code, {
                msgId,
                signal: runAllSignal,
              })
            ) {
              applyMessageToCell(codeCell, msg);
              if (
                msg.header.msg_type === "execute_reply" &&
                (msg.content as { status?: string }).status
              ) {
                execStatus = (msg.content as { status: string }).status;
              }
            }
          } catch {
            execStatus = "error";
          } finally {
            complete(kr, msgId);
          }

          completed++;

          if (execStatus === "error") {
            // Q2: stop on error, cancel remaining queued
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
        // Guard against clobbering "restarting" set by a concurrent restartKernel (FR-011).
        if (kr.execState === "busy") kr.execState = "idle";
        // Re-render after all cells executed
        try {
          const config = await loadConfig(denops);
          const caps = await detectCapabilities(denops);
          const plan = buildRenderPlan(
            session!.notebook,
            caps,
            renderPlanOpts(config),
          );
          sessionStore.setRenderPlan(bn, plan);
          await applyRenderPlan(denops, bn, plan);
        } catch {
          // Re-render failure is non-fatal
        }
      }

      if (!errorStopped) {
        const skipParts: string[] = [];
        if (markdownSkipped > 0) skipParts.push(`${markdownSkipped} markdown`);
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

      // Signal restart-in-progress so interruptKernel guards skip (FR-011)
      kr.execState = "restarting";

      try {
        await kr.client.restart();

        // Reset execution_count for all code cells (Story 4 acceptance #1)
        for (const cell of session!.notebook.cells) {
          if (cell.cell_type === "code") {
            (cell as CodeCell).execution_count = null;
          }
        }

        // Full re-render to show cleared execution counts
        try {
          const config = await loadConfig(denops);
          const caps = await detectCapabilities(denops);
          const plan = buildRenderPlan(
            session!.notebook,
            caps,
            renderPlanOpts(config),
          );
          sessionStore.setRenderPlan(bn, plan);
          await applyRenderPlan(denops, bn, plan);
        } catch {
          // Re-render failure is non-fatal
        }

        await denops.cmd(
          `echom ${vimSingleQuote("Europa: Kernel restarted")}`,
        );
      } catch (e) {
        // Safety: reset execState if restart failed before restart.ts could reset it
        if (kr.execState === "restarting") kr.execState = "idle";
        const msg = e instanceof EuropaKernelError ? e.message : String(e);
        await denops.cmd(
          `echom ${vimSingleQuote(`Europa: Kernel restart failed: ${msg}`)}`,
        );
      }
    },
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

      // FR-011: cannot interrupt during restart or reconnect
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

      // FR-010: idle state — show info but still send REST (idempotent 204)
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
    // @spec-id europa.dispatcher.cancel-cell
    async cancelCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `cancelCell: invalid bufnr '${_bufnr}'`,
        );
      }
      if (typeof _cellId !== "string" || _cellId.length === 0) {
        throw new EuropaKernelError(
          "INVALID_ARGS",
          `cancelCell: cellId must be a non-empty string`,
        );
      }
      const cellId = _cellId;

      const session = sessionStore.get(bn);
      const kr = session?.kernelRuntime;
      if (!kr) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: No kernel attached.")}`,
        );
        return;
      }

      if (cancelQueued(kr, cellId)) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: Cancelled queued cell")}`,
        );
        return;
      }

      // cancelQueued returned false — entry was not in 'queued' state
      const state = kr.cellStates.get(cellId);
      if (state === "busy") {
        await denops.cmd(
          `echom ${
            vimSingleQuote(
              "Europa: Cell is already running. Use :EuropaInterrupt to stop.",
            )
          }`,
        );
        return;
      }

      // Check if cell exists in notebook
      const cell = session!.notebook.cells.find((c) => c.id === cellId);
      if (!cell) {
        await denops.cmd(
          `echom ${vimSingleQuote("Europa: No cell at cursor")}`,
        );
        return;
      }

      await denops.cmd(
        `echom ${
          vimSingleQuote(
            `Europa: Cell is not queued (state=${state ?? "idle"})`,
          )
        }`,
      );
    },

    // Phase 4: ZMQ attach
    attachKernel(_connectionFile: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("attachKernel"));
    },

    // Phase 008: spec-id added in T024 once dispatcher-undo_spec.ts exists.
    async europaUndo(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bn}`);
        return;
      }
      const accepted = session.undoHistory.enqueueUndo();
      if (!accepted) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: undo busy, retry")
          } | echohl None`,
        );
      }
    },

    // Phase 008: spec-id added in T024 once dispatcher-undo_spec.ts exists.
    async europaRedo(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      const session = sessionStore.get(bn);
      if (!session) {
        await echomError(denops, `no open session for buffer ${bn}`);
        return;
      }
      const accepted = session.undoHistory.enqueueRedo();
      if (!accepted) {
        await denops.cmd(
          `echohl WarningMsg | echom ${
            vimSingleQuote("Europa: redo busy, retry")
          } | echohl None`,
        );
      }
    },
  };
}

/**
 * Denops plugin entry point.
 *
 * Called once by the Denops runtime when the plugin loads. Registers the
 * Europa dispatcher so Vim can call `denops#notify('europa', 'init', [])`.
 *
 * @param denops - Denops instance provided by the runtime.
 */
export function main(denops: Denops): Promise<void> {
  denops.dispatcher = buildDispatcher(denops);
  return Promise.resolve();
}
