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
import { applyRenderPlan } from "./view/viewer.ts";
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

    cleanup(bufnr: unknown): Promise<void> {
      sessionStore.remove(Number(bufnr));
      return Promise.resolve();
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
      await applyRenderPlan(denops, bufnrNum, plan);
    },

    /**
     * Save the open notebook back to disk as canonical JSON.
     *
     * Reads the session's stored `Notebook`, serializes it with
     * {@link serializeNotebook} (1-space indent, trailing LF), and writes
     * atomically to `session.notebookPath`. On success, clears the modified
     * flag with `setlocal nomodified`. On failure, reports via `:messages`
     * without overwriting the original file.
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
        await denops.cmd("setlocal nomodified");
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

    // Phase 3+: editing methods — not yet implemented
    insertCell(
      _bufnr: unknown,
      _type: unknown,
      _position: unknown,
    ): Promise<void> {
      return Promise.reject(new UnimplementedError("insertCell"));
    },
    deleteCell(_bufnr: unknown, _cellId: unknown): Promise<void> {
      return Promise.reject(new UnimplementedError("deleteCell"));
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
