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
  return async (pngData: Uint8Array) => {
    try {
      const proc = new Deno.Command(magickCmd, {
        args: ["png:-", "sixel:-"],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });
      const child = proc.spawn();
      const writer = child.stdin.getWriter();
      await writer.write(pngData);
      await writer.close();
      const { code, stdout } = await child.output();
      return code === 0 ? stdout : null;
    } catch {
      return null;
    }
  };
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

  let anyWritten = false;
  for (const sp of placements) {
    const pngBytes = decodeBase64(sp.payload);
    const sixelBytes = await conv(pngBytes);
    if (!sixelBytes) {
      await host.cmd(
        "echohl WarningMsg | echom 'Europa: Sixel conversion failed — falling back to placeholder' | echohl None",
      );
      continue;
    }
    // Write sixel bytes to /dev/tty via Vim writefile in binary mode.
    // Latin-1 gives a 1:1 byte↔char mapping, preserving all 256 code points.
    const latin1 = new TextDecoder("latin1").decode(sixelBytes);
    await host.call("writefile", [latin1], "/dev/tty", "b");
    anyWritten = true;
  }

  if (anyWritten) {
    // Register repaint autocmds so Sixel images re-draw on scroll/resize (FR-022).
    await host.cmd(
      `augroup EuropaSixel_${bufnr} | autocmd! | ` +
        `autocmd WinScrolled,VimResized,BufEnter <buffer=${bufnr}> ` +
        `call denops#notify('europa', 'refreshSixel', [${bufnr}]) | ` +
        `augroup END`,
    );
  }
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
 * PNG to Sixel via ImageMagick and written to `/dev/tty`. `WinScrolled`,
 * `VimResized`, and `BufEnter` autocmds are registered for repaint (FR-022).
 * If ImageMagick is absent or conversion fails the viewer falls back to the
 * placeholder line already in the buffer and emits a WarningMsg (FR-021).
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
