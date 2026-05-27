/**
 * Viewer: applies a RenderPlan to a Vim/Neovim buffer, resolves cursor
 * positions to cell ids, and manages the per-cell scratch edit buffers.
 *
 * @category View
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 * @spec-id europa.view.viewer.sixel-apply
 * @spec-id europa.view.viewer.sixel-fallback
 */

import type { Denops } from "@denops/std";
import { decodeBase64 } from "@std/encoding/base64";
import type {
  CellRange,
  RenderPlan,
  SixelPlacement,
} from "../../../schema/render-plan.ts";
import type { Cell, Notebook } from "../../../schema/notebook.ts";
import {
  applyMdDecorations,
  ensureMdOverlayBufferOptions,
} from "./markdown-overlay-nvim.ts";
import { applyTracebackHighlights } from "./traceback-jump.ts";

/**
 * Converts raw PNG bytes to Sixel bytes.
 *
 * Injected via `opts._magickConverter` in tests so no subprocess is spawned.
 */
export type MagickConverter = (data: Uint8Array) => Promise<Uint8Array | null>;

async function findMagick(): Promise<string | null> {
  for (const cmd of ["magick", "convert"]) {
    try {
      const { code } = await new Deno.Command(cmd, {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      }).output();
      if (code === 0) return cmd;
    } catch { /* not installed */ }
  }
  return null;
}

function makeMagickConverter(magickCmd: string): MagickConverter {
  return async (imageData: Uint8Array) => {
    try {
      const proc = new Deno.Command(magickCmd, {
        args: ["-", "sixel:-"],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });
      const child = proc.spawn();
      const writer = child.stdin.getWriter();
      await writer.write(imageData);
      await writer.close();
      const { code, stdout } = await child.output();
      return code === 0 ? stdout : null;
    } catch {
      return null;
    }
  };
}

async function writeBytesToTty(host: Denops, bytes: Uint8Array): Promise<void> {
  // Latin-1 decode gives a 1:1 byte↔char mapping, preserving all 256 code
  // points so binary Sixel escapes survive the JS→msgpack-rpc→host hop.
  const latin1 = new TextDecoder("latin1").decode(bytes);
  if (host.meta.host === "nvim") {
    // Neovim launched via lazy.nvim cannot writefile to /dev/tty since the
    // editor process has no controlling terminal — writefile raises E482.
    // v:stderr must be used instead because it is the documented channel
    // for emitting raw escape sequences from a denops plugin to the
    // terminal in Neovim.
    const stderrChan = await host.eval("v:stderr");
    await host.call("chansend", stderrChan, latin1);
  } else {
    // Vim: writefile to /dev/tty in binary mode.  A single-element list
    // avoids the inter-element separator that 'b' mode would otherwise add.
    await host.call("writefile", [latin1], "/dev/tty", "b");
  }
}

/**
 * Wrap raw Sixel bytes with DECSC + cursor-position move + DECRC so the image
 * is anchored at (row, col) and the editor's cursor is restored afterward.
 *
 * Sequence emitted: ESC 7 (save cursor), ESC [ row ; col H (move), <sixel>,
 * ESC 8 (restore cursor).  Coordinates are 1-indexed to match the ANSI spec
 * and Vim's `screenpos()` return values.
 */
function wrapWithCursorMove(
  sixel: Uint8Array,
  row: number,
  col: number,
): Uint8Array {
  const enc = new TextEncoder();
  const prefix = enc.encode(`\x1b7\x1b[${row};${col}H`);
  const suffix = enc.encode("\x1b8");
  const out = new Uint8Array(prefix.length + sixel.length + suffix.length);
  out.set(prefix, 0);
  out.set(sixel, prefix.length);
  out.set(suffix, prefix.length + sixel.length);
  return out;
}

async function applySixelPlacements(
  host: Denops,
  bufnr: number,
  placements: SixelPlacement[],
  converter?: MagickConverter,
): Promise<void> {
  let conv = converter;
  if (!conv) {
    const magickCmd = await findMagick();
    if (!magickCmd) {
      await host.cmd(
        "echohl WarningMsg | echom 'Europa: ImageMagick not found — install it or unset g:europa_image_backend' | echohl None",
      );
      return;
    }
    conv = makeMagickConverter(magickCmd);
  }

  const winid = await host.call("bufwinid", bufnr);
  if (typeof winid !== "number" || winid === -1) return;

  // Force a screen update because applyRenderPlan runs inside an RPC call —
  // the buffer text has been written via setbufline but the screen has not
  // yet been redrawn, so screenpos() would otherwise report stale rows.
  await host.cmd("redraw");

  for (const sp of placements) {
    // Check screen position first — skip off-screen images before spending
    // time on base64 decode or an ImageMagick subprocess.
    const pos = await host.call("screenpos", winid, sp.line + 1, 1) as
      | { row?: number; col?: number }
      | null;
    const row = pos && typeof pos.row === "number" ? pos.row : 0;
    const col = pos && typeof pos.col === "number" ? pos.col : 0;
    // screenpos returns row 0 when the line is scrolled off-screen — skip
    // because writing Sixel without a valid anchor would clobber unrelated
    // rows (this is the bug the user hit when the image landed at home).
    if (row === 0) continue;

    let imageBytes: Uint8Array;
    try {
      imageBytes = decodeBase64(sp.payload);
    } catch {
      await host.cmd(
        "echohl WarningMsg | echom 'Europa: Invalid image payload — keeping placeholder' | echohl None",
      );
      continue;
    }
    const sixelBytes = await conv(imageBytes);
    if (!sixelBytes) {
      await host.cmd(
        "echohl WarningMsg | echom 'Europa: Sixel conversion failed — falling back to placeholder' | echohl None",
      );
      continue;
    }
    // Anchor the image one row below the placeholder so the
    // `[image: ...]` text remains visible (and the clickable
    // :EuropaPreviewOutput command stays accessible) above the picture.
    await writeBytesToTty(host, wrapWithCursorMove(sixelBytes, row + 1, col));
  }

  // Repaint autocmds (FR-022) are deferred because they must call a
  // `refreshSixel` dispatcher (not yet implemented).  Registering the
  // autocmd now would raise on every WinScrolled since the dispatcher is
  // missing.  Re-add once `refreshSixel` lands.
}

/**
 * Resolve a 1-origin viewer buffer line number to the cell id that contains it.
 *
 * Performs a linear scan over `cellRanges` (sufficient for < 1000 cells).
 * Converts the 1-origin Vim `line('.')` value to 0-origin before comparing.
 *
 * @param cellRanges - Ordered array from the most recent `RenderPlan`.
 * @param line - 1-origin line number (as returned by Vim's `line('.')`).
 * @returns The matching `cellId`, or `null` if the line is outside all ranges.
 * @category View
 * @spec-id europa.view.viewer.line-to-cellid
 */
export function lineToCellId(
  cellRanges: readonly CellRange[],
  line: number,
): string | null {
  const zero = line - 1;
  for (const range of cellRanges) {
    if (zero >= range.startLine && zero <= range.endLine) {
      return range.cellId;
    }
  }
  return null;
}

/**
 * Restore the cursor after a structural mutation using a 5-stage priority:
 *
 * 1. `hint.preferCellId` — move to the hint cell (e.g. newly inserted cell).
 * 2. `preMutationCellId` still present in `newCellRanges` — move there.
 * 3. Same index in `newCellRanges` as the pre-mutation cell had — adjacent fallback.
 * 4. Last cell in `newCellRanges` — end-of-notebook fallback.
 * 5. Empty notebook (`newCellRanges` is empty) — move to line 1.
 *
 * When `winid` is a positive integer the cursor moves are wrapped with
 * `win_execute` so the viewer's window is targeted regardless of the
 * caller's current window (e.g. a scratch edit buffer triggering an
 * insertCell RPC). A non-positive `winid` falls back to the current
 * window.
 *
 * @param denops - Denops instance for emitting cursor commands.
 * @param winid - Viewer window id (`bufwinid(bufnr)`); pass `-1` to
 *   target the current window.
 * @param preMutationCellId - The cellId the cursor was in before the mutation.
 * @param preMutationCellRanges - `cellRanges` before the mutation.
 * @param newCellRanges - `cellRanges` after the mutation.
 * @param hint - Optional preferred cellId (e.g. newly inserted cell).
 * @category View
 * @spec-id europa.view.viewer.restore-cursor
 */
export async function restoreCursor(
  denops: Denops,
  winid: number,
  preMutationCellId: string | null,
  preMutationCellRanges: readonly CellRange[],
  newCellRanges: readonly CellRange[],
  hint?: { preferCellId?: string },
): Promise<void> {
  if (winid <= 0) return;
  const cursorCmd = (line: number, col = 1) =>
    `call win_execute(${winid}, 'call cursor(${line}, ${col})')`;
  // (1) hint overrides everything
  if (hint?.preferCellId) {
    const r = newCellRanges.find((r) => r.cellId === hint.preferCellId);
    if (r) {
      await denops.cmd(cursorCmd(r.startLine + 1));
      return;
    }
  }
  // (2) pre-mutation cell still exists
  if (preMutationCellId) {
    const r = newCellRanges.find((r) => r.cellId === preMutationCellId);
    if (r) {
      await denops.cmd(cursorCmd(r.startLine + 1));
      return;
    }
  }
  // (3) same index in newCellRanges
  const idx = preMutationCellRanges.findIndex(
    (r) => r.cellId === preMutationCellId,
  );
  if (idx >= 0 && idx < newCellRanges.length) {
    await denops.cmd(cursorCmd(newCellRanges[idx].startLine + 1));
    return;
  }
  // (4) last cell
  if (newCellRanges.length > 0) {
    const last = newCellRanges[newCellRanges.length - 1];
    await denops.cmd(cursorCmd(last.startLine + 1));
    return;
  }
  // (5) empty notebook
  await denops.cmd(cursorCmd(1));
}

/**
 * Apply a `RenderPlan` to a buffer.
 *
 * Writes the plan's lines into the target buffer using `setbufline`, then
 * locks the buffer (`&modifiable=0`), marks it `nomodified` (so `:q` does
 * not warn about pending changes), sets `&buftype=acwrite` (writes go
 * through the `BufWriteCmd` autocmd registered in `session/events.ts`),
 * and `setlocal conceallevel=0` via `win_execute` on the buffer's window
 * (conceallevel is window-local, so `setbufvar` cannot reach it). When a
 * `viewport` is provided, only the visible range is rendered (lazy
 * rendering for large notebooks).
 *
 * When `plan.sixelPlacements` is non-empty, each placement is converted from
 * PNG to Sixel via ImageMagick and emitted to the terminal: Vim uses
 * `writefile('/dev/tty', 'b')`, Neovim uses `chansend(v:stderr, ...)` since
 * a denops-launched Neovim has no controlling tty.  If ImageMagick is absent
 * or conversion fails the viewer falls back to the placeholder line already
 * in the buffer and emits a WarningMsg (FR-021).  Repaint on scroll/resize
 * (FR-022) is deferred — see `applySixelPlacements` for details.
 *
 * Uses buffer-targeted APIs (`setbufline`, `setbufvar`) so the render
 * lands on the correct buffer even when this runs after the user has
 * switched buffers — `denops#notify` is asynchronous relative to
 * `BufReadCmd`.
 *
 * @param host - Active Denops instance.
 * @param bufnr - Target buffer number.
 * @param plan - RenderPlan produced by `buildRenderPlan`.
 * @param opts - Optional rendering configuration.
 */
export async function applyRenderPlan(
  host: Denops,
  bufnr: number,
  plan: RenderPlan,
  opts?: {
    viewport?: { topLine: number; bottomLine: number };
    _magickConverter?: MagickConverter;
    /**
     * When provided, only lines from the given cell's startLine onwards are
     * written via setbufline. Lines above are left untouched so that Vim
     * text-property and Neovim extmark IDs for those cells remain
     * bit-identical (SC-003 / Q2=B). Falls back to the full-render path when
     * the cellId is not found in `plan.cellRanges`.
     *
     * @spec-id europa.render.partial.below-cell-line-offset-reattach
     * @spec-id europa.render.partial.above-cell-bit-identical
     */
    fromCellId?: string;
  },
): Promise<void> {
  const isNvim = await host.call("has", "nvim") === 1 ||
    host.meta.host === "nvim";
  await host.call("setbufvar", bufnr, "&modifiable", 1);

  // Determine the first line to write. When fromCellId is provided and found
  // in the plan, skip all lines above that cell (bit-identical preservation).
  const firstAffectedLine = (() => {
    if (!opts?.fromCellId) return 0;
    const range = plan.cellRanges?.find((r) => r.cellId === opts.fromCellId);
    return range ? range.startLine : 0; // not found → full render
  })();

  try {
    const topOffset = opts?.viewport
      ? opts.viewport.topLine
      : firstAffectedLine;
    const lines = opts?.viewport
      ? plan.lines.slice(opts.viewport.topLine, opts.viewport.bottomLine + 1)
      : plan.lines.slice(firstAffectedLine);

    if (lines.length > 0) {
      await host.call("setbufline", bufnr, topOffset + 1, lines);
    }

    await host.call("deletebufline", bufnr, plan.lines.length + 1, "$");

    await host.call("setbufvar", bufnr, "&buftype", "acwrite");

    const winid = await host.call("bufwinid", bufnr);
    if (typeof winid === "number" && winid !== -1) {
      await host.call("win_execute", winid, "setlocal conceallevel=0");
    }
  } finally {
    await host.call("setbufvar", bufnr, "&modified", 0);
    await host.call("setbufvar", bufnr, "&modifiable", 0);
  }

  // Force a screen update so dispatcher-driven setbufline / deletebufline
  // results are visible immediately. Async `denops#notify` paths (insertCell,
  // undo / redo, etc.) update the buffer text via RPC but Vim defers the
  // screen redraw until the next keystroke; without this nudge the user
  // sees stale lines layered over the new render and the operation looks
  // like it did the wrong thing. `applySixelPlacements` already issues its
  // own redraw for `screenpos()`, so this is harmlessly redundant on the
  // sixel path (`:redraw` is idempotent within a frame).
  await host.cmd("redraw");

  // Phase 3.8: emit EuropaErrorJump / EuropaErrorJumpMissing extmarks (Neovim)
  // or text-properties (Vim) so traceback frames are visually clickable.
  // buildRenderPlan runs rewriteMissingHighlights before returning, so
  // non-actionable frames already carry the Missing variant by the time we
  // reach here.
  await applyTracebackHighlights(host, bufnr, plan);

  if (plan.sixelPlacements && plan.sixelPlacements.length > 0) {
    await applySixelPlacements(
      host,
      bufnr,
      plan.sixelPlacements,
      opts?._magickConverter,
    );
  }

  // TODO: register BufWinEnter / WinScrolled / BufWipeout hooks once the
  // viewer owns autocmd plumbing for markdown overlay lifecycle updates.
  if (isNvim) {
    await ensureMdOverlayBufferOptions(host, bufnr);
    if (plan.mdDecorations.length === 0) return;
    const viewport = (() => {
      if (opts?.viewport) {
        return {
          top: opts.viewport.topLine + 1,
          bottom: opts.viewport.bottomLine + 1,
        };
      }
      return null;
    })();
    const resolvedViewport = viewport ??
      (() => ({
        top: 1,
        bottom: plan.lines.length,
      }))();

    if (!viewport) {
      // Resolve the viewport against the window currently displaying `bufnr`,
      // not the current window: applyMdDecorations is scheduled via
      // `setTimeout(0)` and the user may have switched windows in between,
      // which would otherwise yield bounds for an unrelated buffer.
      const winid = await host.call("bufwinid", bufnr);
      if (typeof winid === "number" && winid > 0) {
        const info = await host.call("getwininfo", winid);
        if (
          Array.isArray(info) &&
          info[0] &&
          typeof (info[0] as { topline?: number }).topline === "number" &&
          typeof (info[0] as { botline?: number }).botline === "number"
        ) {
          const wi = info[0] as { topline: number; botline: number };
          resolvedViewport.top = wi.topline;
          resolvedViewport.bottom = wi.botline;
        }
      }
    }

    if (opts?.fromCellId) {
      await applyMdDecorations(
        host,
        bufnr,
        plan.mdDecorations,
        resolvedViewport,
      );
    } else {
      setTimeout(() => {
        void applyMdDecorations(
          host,
          bufnr,
          plan.mdDecorations,
          resolvedViewport,
        );
      }, 0);
    }
  }
}

/**
 * Resolve the filetype for a cell's scratch edit buffer.
 *
 * Markdown cells always render as `markdown`. Raw cells get an empty
 * filetype so no LSP/treesitter attaches. Code cells consult notebook
 * metadata in priority order: `kernelspec.language` first (the kernel
 * the user picked), then `language_info.name` (the kernel that ran the
 * notebook last), and finally fall back to `python` so a fresh notebook
 * with no kernel still gets a sensible default (R4).
 *
 * @param notebook - Notebook containing the cell.
 * @param cell - The cell whose scratch buffer is being opened.
 * @returns A Vim filetype string (possibly empty for raw cells).
 * @category View
 * @spec-id europa.view.viewer.resolve-filetype
 */
export function resolveScratchFiletype(
  notebook: Notebook,
  cell: Cell,
): string {
  if (cell.cell_type === "markdown") return "markdown";
  if (cell.cell_type === "raw") return "";
  const ks = notebook.metadata?.kernelspec?.language;
  if (typeof ks === "string" && ks.length > 0) return ks;
  const li = notebook.metadata?.language_info?.name;
  if (typeof li === "string" && li.length > 0) return li;
  return "python";
}

/**
 * Open (or reuse) a scratch buffer for editing a single cell's source.
 *
 * Pure host I/O: this function never touches `SessionStore`. The dispatcher
 * computes the filetype, looks up an existing scratch bufnr, then hands a
 * complete options bag to this function which performs the buffer
 * lifecycle: `bufadd` → `bufload` → option configuration → source
 * injection → buffer-local variables → autocmd group → `:split`.
 *
 * Reuse path: when `existingScratchBufnr` is supplied and that buffer
 * still exists, the function emits `:buffer N` to focus it without
 * recreating the autocmds or rewriting the source.
 *
 * @param denops - Active Denops instance.
 * @param opts - Buffer name, cell context, source lines, filetype, and
 *   optional existing scratch bufnr for the reuse path.
 * @returns The scratch buffer number (newly assigned or reused).
 * @category View
 * @spec-id europa.view.viewer.scratch-open
 */
export async function openCellEditBuffer(
  denops: Denops,
  opts: {
    bufname: string;
    cellId: string;
    viewerBufnr: number;
    sourceLines: string[];
    filetype: string;
    existingScratchBufnr?: number;
  },
): Promise<number> {
  if (opts.existingScratchBufnr !== undefined) {
    const exists = await denops.call("bufexists", opts.existingScratchBufnr);
    if (exists) {
      // Reuse the scratch's existing window when one is already showing it.
      // A bare `:buffer N` would overwrite the current window, which is
      // typically the viewer when this is reached, hiding the notebook.
      const winids = await denops.call(
        "win_findbuf",
        opts.existingScratchBufnr,
      ) as number[];
      if (winids.length > 0) {
        await denops.call("win_gotoid", winids[0]);
      } else {
        await denops.cmd(`split #${opts.existingScratchBufnr}`);
      }
      return opts.existingScratchBufnr;
    }
  }

  const scratchBufnr = await denops.call("bufadd", opts.bufname) as number;
  await denops.call("bufload", scratchBufnr);

  await denops.call("setbufvar", scratchBufnr, "&buftype", "acwrite");
  await denops.call("setbufvar", scratchBufnr, "&swapfile", 0);
  await denops.call("setbufvar", scratchBufnr, "&bufhidden", "hide");
  await denops.call("setbufvar", scratchBufnr, "&modifiable", 1);
  await denops.call("setbufvar", scratchBufnr, "&buflisted", 0);
  await denops.call("setbufvar", scratchBufnr, "&filetype", opts.filetype);

  await denops.call("setbufline", scratchBufnr, 1, opts.sourceLines);
  await denops.call("setbufvar", scratchBufnr, "&modified", 0);

  await denops.call("setbufvar", scratchBufnr, "europa_cell_id", opts.cellId);
  await denops.call(
    "setbufvar",
    scratchBufnr,
    "europa_viewer_bufnr",
    opts.viewerBufnr,
  );

  const group = `europa_cell_edit_${scratchBufnr}`;
  await denops.cmd(`augroup ${group}`);
  await denops.cmd("autocmd!");
  // BufWriteCmd must be synchronous: with `denops#notify`, `:wq` lets
  // BufWipeout fire and Vim wipes the buffer before saveCellEdit's
  // getbufline reads it, returning an empty list and overwriting
  // cell.source with "". `denops#request` blocks until save completes.
  await denops.cmd(
    `autocmd BufWriteCmd <buffer=${scratchBufnr}> call denops#request('europa', 'saveCellEdit', [${scratchBufnr}])`,
  );
  await denops.cmd(
    `autocmd BufWipeout <buffer=${scratchBufnr}> call denops#notify('europa', 'closeCellEdit', [${scratchBufnr}])`,
  );
  await denops.cmd("augroup END");

  await denops.cmd(`split #${scratchBufnr}`);
  return scratchBufnr;
}

/**
 * Freeze a scratch buffer when its underlying cell has been deleted.
 *
 * The buffer is briefly made modifiable so the deletion marker can be
 * appended at the end, then locked (`&modifiable=0`, `&buftype=nofile`)
 * so the user can still copy content out but cannot `:write` it back.
 * The dirty flag is cleared so `:q` does not warn about pending changes.
 *
 * @param denops - Active Denops instance.
 * @param scratchBufnr - Scratch buffer number to freeze.
 * @param cellId - The deleted cell's id, surfaced in the warning message.
 * @category View
 * @spec-id europa.view.viewer.scratch-freeze
 */
export async function freezeCellEditBuffer(
  denops: Denops,
  scratchBufnr: number,
  cellId: string,
): Promise<void> {
  await denops.call("setbufvar", scratchBufnr, "&modifiable", 1);
  await denops.call(
    "appendbufline",
    scratchBufnr,
    "$",
    "[Cell deleted from notebook]",
  );
  await denops.call("setbufvar", scratchBufnr, "&modifiable", 0);
  await denops.call("setbufvar", scratchBufnr, "&buftype", "nofile");
  await denops.call("setbufvar", scratchBufnr, "&modified", 0);
  await denops.cmd(
    `echohl WarningMsg | echom 'Europa: Cell ${cellId} was deleted; scratch buffer is now read-only' | echohl None`,
  );
}

/**
 * Tear down the per-scratch autocmd group.
 *
 * Called on `closeCellEdit` so that BufWriteCmd / BufWipeout autocmds
 * registered against the wiped scratch bufnr do not linger. Pure host I/O.
 *
 * @param denops - Active Denops instance.
 * @param scratchBufnr - Scratch buffer whose group should be removed.
 * @category View
 */
export async function closeCellEditAutocmds(
  denops: Denops,
  scratchBufnr: number,
): Promise<void> {
  const group = `europa_cell_edit_${scratchBufnr}`;
  await denops.cmd(`augroup ${group} | autocmd! | augroup END`);
  await denops.cmd(`augroup! ${group}`);
}
