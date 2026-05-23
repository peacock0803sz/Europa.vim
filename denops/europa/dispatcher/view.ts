import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import { decodeBase64 } from "@std/encoding/base64";
import { encodeHex } from "@std/encoding/hex";
import { ensureDir } from "@std/fs";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import { buildRenderPlan, mergeStreams } from "../render/builder.ts";
import {
  clearMdOverlay,
  onMdOverlayScroll as onMdOverlayScrollImpl,
} from "../view/markdown-overlay-nvim.ts";
import { applyRenderPlan } from "../view/viewer.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "./context.ts";
import { scheduleHighlightRefresh } from "./syntax-highlight.ts";

/** Image MIME types supported by `:EuropaPreviewOutput`, in priority order. */
export const IMAGE_MIMES = ["image/png", "image/jpeg"] as const;
type ImageMime = typeof IMAGE_MIMES[number];

/** Map image MIME to a file suffix for the temp file. */
export const MIME_SUFFIX: Record<ImageMime, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

export function buildViewDispatcher(
  ctx: DispatcherContext,
): Pick<
  EuropaDispatcher,
  | "previewOutput"
  | "onBufWinEnter"
  | "onMdOverlayScroll"
  | "onMdOverlayWipeout"
  | "jumpToTraceback"
  | "jumpToTracebackList"
> {
  const { denops, sessionStore } = ctx;
  return {
    /**
     * Open an image cell output in the OS default external viewer.
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

      // SVG preview: write original SVG bytes to a fixed-path temp file so that
      // the OS viewer receives the SVG source rather than the shadow-injected PNG.
      // The path must include the full 64-char SHA-256 of the SVG bytes (SC-006).
      // nbformat allows image/svg+xml as string or string[]; join arrays before
      // hashing/writing so matplotlib-style multi-line emissions are handled.
      // @spec-id europa.dispatcher.view.preview-svg
      const svgValue = data["image/svg+xml"];
      const svgText = typeof svgValue === "string"
        ? svgValue
        : Array.isArray(svgValue)
        ? svgValue.join("")
        : undefined;
      if (svgText !== undefined) {
        const svgBytes = new TextEncoder().encode(svgText);
        const digest = await crypto.subtle.digest("SHA-256", svgBytes);
        const sha256 = encodeHex(new Uint8Array(digest));
        const svgDir = "/tmp/europa";
        const svgPath = `${svgDir}/svg-preview-${sha256}.svg`;
        try {
          await ensureDir(svgDir);
          await Deno.writeTextFile(svgPath, svgText);
        } catch {
          await echomError(denops, "failed to write SVG preview file");
          return;
        }
        try {
          const os = Deno.build.os;
          let cmd: string;
          let args: string[];
          if (os === "darwin") {
            cmd = "open";
            args = [svgPath];
          } else if (os === "linux") {
            cmd = "xdg-open";
            args = [svgPath];
          } else if (os === "windows") {
            cmd = "cmd";
            args = ["/c", "start", "", svgPath];
          } else {
            await echomError(
              denops,
              `unsupported OS '${os}' - open ${svgPath} manually`,
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
                ? `failed to launch external SVG viewer (exit ${result.code}): ${stderrText}`
                : `failed to launch external SVG viewer (exit ${result.code})`,
            );
          }
        } catch {
          await echomError(denops, "failed to launch external SVG viewer");
        }
        return;
      }

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
            `unsupported OS '${os}' - open ${tempPath} manually`,
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
     * Full re-render when a viewer buffer becomes visible after being hidden.
     *
     * @spec-id europa.session.hidden-buffer.bufwinenter-resync
     */
    async onBufWinEnter(_bufnr: unknown): Promise<void> {
      const bn = Number(_bufnr);
      if (!Number.isInteger(bn) || bn < 1) return;
      const session = sessionStore.get(bn);
      if (!session) return;
      try {
        const config = await loadConfig(denops);
        const caps = await detectCapabilities(denops);
        const plan = await buildRenderPlan(
          session.notebook,
          caps,
          renderPlanOpts(config),
        );
        sessionStore.setRenderPlan(bn, plan);
        await applyRenderPlan(denops, bn, plan);
        scheduleHighlightRefresh(ctx, bn); // FR-007: BufWinEnter re-render follow-up
      } catch {
        // Re-render failure is non-fatal.
      }
    },

    /**
     * Refresh markdown overlay extmarks after a viewer window scrolls.
     *
     * @spec-id europa.dispatcher.md-overlay-scroll
     */
    async onMdOverlayScroll(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 1) return;
      if (denops.meta.host !== "nvim") return;

      const winid = await denops.call("bufwinid", bn);
      if (typeof winid !== "number" || winid <= 0) return;

      const info = await denops.call("getwininfo", winid);
      if (
        !Array.isArray(info) ||
        !info[0] ||
        typeof (info[0] as { topline?: number }).topline !== "number" ||
        typeof (info[0] as { botline?: number }).botline !== "number"
      ) {
        return;
      }

      const wi = info[0] as { topline: number; botline: number };
      await onMdOverlayScrollImpl(denops, bn, {
        top: wi.topline,
        bottom: wi.botline,
      });
    },

    /**
     * Drop markdown overlay state when the viewer buffer is wiped out.
     *
     * @spec-id europa.dispatcher.md-overlay-wipeout
     */
    async onMdOverlayWipeout(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 1) return;
      await clearMdOverlay(denops, bn);
    },

    // Phase 3.8 traceback jump RPCs — stubs only; behavior is wired up in
    // Phase 3 (jumpToTraceback) and Phase 5 (jumpToTracebackList) of the 012
    // plan. The @spec-id tags are attached at that point alongside paired
    // spec tests (lint-spec-id-bijection requires both sides).
    jumpToTraceback(
      _bufnr: unknown,
      _line: unknown,
      _col: unknown,
    ): Promise<void> {
      return Promise.resolve();
    },

    jumpToTracebackList(_bufnr: unknown): Promise<void> {
      return Promise.resolve();
    },
  };
}
