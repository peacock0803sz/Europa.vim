/**
 * Viewer: applies a RenderPlan to a Vim/Neovim buffer.
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
  RenderPlan,
  SixelPlacement,
} from "../../../schema/render-plan.ts";

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
  },
): Promise<void> {
  await host.call("setbufvar", bufnr, "&modifiable", 1);

  try {
    const topOffset = opts?.viewport ? opts.viewport.topLine : 0;
    const lines = opts?.viewport
      ? plan.lines.slice(opts.viewport.topLine, opts.viewport.bottomLine + 1)
      : plan.lines;

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

  if (plan.sixelPlacements && plan.sixelPlacements.length > 0) {
    await applySixelPlacements(
      host,
      bufnr,
      plan.sixelPlacements,
      opts?._magickConverter,
    );
  }
}
