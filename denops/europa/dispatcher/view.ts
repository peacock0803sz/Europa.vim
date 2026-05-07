import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import { decodeBase64 } from "@std/encoding/base64";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import { buildRenderPlan, mergeStreams } from "../render/builder.ts";
import { applyRenderPlan } from "../view/viewer.ts";
import {
  type DispatcherContext,
  echomError,
  renderPlanOpts,
} from "./context.ts";

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
): Pick<EuropaDispatcher, "previewOutput" | "onBufWinEnter"> {
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
        const plan = buildRenderPlan(
          session.notebook,
          caps,
          renderPlanOpts(config),
        );
        sessionStore.setRenderPlan(bn, plan);
        await applyRenderPlan(denops, bn, plan);
      } catch {
        // Re-render failure is non-fatal.
      }
    },
  };
}
