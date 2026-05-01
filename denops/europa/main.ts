/**
 * @packageDocumentation
 *
 * Europa.vim — Jupyter Notebook viewer for Vim and Neovim.
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
 * ## Phase Coverage
 *
 * - Phase 2: `init`, `save` (stub), `previewOutput` (stub)
 * - Phase 3 (this release): `open` — reads `.ipynb`, builds a RenderPlan, reflects it to buffer
 * - Phase 3+: cell editing, kernel attach — methods declared but throw `UnimplementedError`
 *
 * @module denops/europa/main
 */

import type { Denops } from "@denops/std";
import type { EuropaDispatcher } from "../../contracts/dispatcher.ts";
import { decodeBase64 } from "@std/encoding/base64";
import { defineHighlights } from "./view/highlight.ts";
import { loadConfig } from "./config.ts";
import { detectCapabilities } from "./capabilities.ts";
import { setupAutocmds } from "./session/events.ts";
import { parseNotebook } from "./notebook/parse.ts";
import { serializeNotebook } from "./notebook/serialize.ts";
import { buildRenderPlan, mergeStreams } from "./render/builder.ts";
import { applyRenderPlan, lineToCellId, restoreCursor } from "./view/viewer.ts";
import { deleteCell, insertCell } from "./notebook/cell.ts";
import { SessionStore } from "./session/state.ts";

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
 */
export function buildDispatcher(denops: Denops): EuropaDispatcher {
  const sessionStore = new SessionStore();

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
     * Iterates all registered scratch buffers, force-wipes each one via
     * `bwipeout!`, removes its dedicated autocmd group, then removes the
     * session from the store. Idempotent: if the session is already gone
     * (e.g. BufUnload fired before BufWipeout) the call is a no-op.
     *
     * @spec-id europa.dispatcher.cleanup-idempotent
     */
    async cleanup(bufnr: unknown): Promise<void> {
      const viewerBufnr = Number(bufnr);
      if (!sessionStore.get(viewerBufnr)) return;
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
      const plan = buildRenderPlan(notebook, caps, {
        maxOutputLines: config.max_output_lines,
      });
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
      const cursorPos = await denops.call("getcurpos") as number[];
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
      const plan = buildRenderPlan(newNotebook, caps, {
        maxOutputLines: config.max_output_lines,
      });
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
        bn,
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
      const cursorPos = await denops.call("getcurpos") as number[];
      const preCellId = lineToCellId(preCellRanges, cursorPos[1] ?? 1);
      const newNotebook = deleteCell(session.notebook, cid);
      if (Object.is(newNotebook, session.notebook)) {
        await echomError(denops, `deleteCell: cell '${cid}' not found`);
        return;
      }
      // Clean up any open scratch buffer for the deleted cell
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
        sessionStore.removeCellEditBuffer(bn, cid);
      }
      const config = await loadConfig(denops);
      const caps = await detectCapabilities(denops);
      const plan = buildRenderPlan(newNotebook, caps, {
        maxOutputLines: config.max_output_lines,
      });
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
        bn,
        preCellId,
        preCellRanges,
        plan.cellRanges,
      );
    },
    moveCell(
      _bufnr: unknown,
      _cellId: unknown,
      _direction: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("moveCell"));
    },
    splitCell(
      _bufnr: unknown,
      _cellId: unknown,
      _line: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("splitCell"));
    },
    joinCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("joinCell"));
    },
    editCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("editCell"));
    },
    changeCellType(
      _bufnr: unknown,
      _cellId: unknown,
      _newType: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("changeCellType"));
    },
    saveCellEdit(_scratchBufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("saveCellEdit"));
    },
    closeCellEdit(_scratchBufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("closeCellEdit"));
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

    // Phase 3 remaining / Phase 4 — not yet implemented
    runCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("runCell"));
    },
    runAll(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("runAll"));
    },
    startKernel(_bufnr: unknown, _name: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("startKernel"));
    },
    restartKernel(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("restartKernel"));
    },
    interruptKernel(_bufnr: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("interruptKernel"));
    },

    // Phase 4: ZMQ attach
    attachKernel(_connectionFile: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("attachKernel"));
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
