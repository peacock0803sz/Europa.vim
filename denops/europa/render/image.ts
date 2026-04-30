/**
 * Image renderer: produces a placeholder fragment for PNG/JPEG cell outputs.
 *
 * Synchronous by design — all Sixel I/O (ImageMagick subprocess, /dev/tty
 * write) lives in `view/viewer.ts` so the render layer stays a pure data
 * transform with no side-effects (DESIGN.md §3.7.5).
 *
 * @category Render
 * @spec-id europa.render.image.placeholder
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type {
  ImageRenderResult,
  RenderFragment,
} from "../../../schema/render-plan.ts";

/**
 * Render an image cell output as a placeholder line.
 *
 * Produces `[image: <kind> <w>x<h> - :EuropaPreviewOutput <cellIdx>
 * <outputIdx>]` with `EuropaImagePlaceholder` highlight and a clickable
 * whose payload carries the `:EuropaPreviewOutput` command.
 *
 * For `caps.image === "sixel"` in Phase 2, the function falls back to a
 * plain placeholder (T103 in US5 will wire the actual Sixel metadata path).
 *
 * @param data - Base64-encoded image bytes (PNG or JPEG).
 * @param mime - MIME type: `"image/png"` or `"image/jpeg"`.
 * @param caps - Host capabilities; used for backend selection.
 * @param meta - Cell/output index and optional pixel dimensions.
 * @returns An `ImageRenderResult` with fragment and optional Sixel placement.
 */
export function renderImage(
  _data: string,
  mime: "image/png" | "image/jpeg",
  _caps: Capabilities,
  meta: { cellIdx: number; outputIdx: number; width?: number; height?: number },
): ImageRenderResult {
  const kind = mime === "image/png" ? "png" : "jpeg";
  const w = meta.width !== undefined ? String(meta.width) : "?";
  const h = meta.height !== undefined ? String(meta.height) : "?";
  const command = `:EuropaPreviewOutput ${meta.cellIdx} ${meta.outputIdx}`;
  const placeholderText = `[image: ${kind} ${w}x${h} - ${command}]`;

  const fragment: RenderFragment = {
    lines: [placeholderText],
    highlights: [
      {
        hlGroup: "EuropaImagePlaceholder",
        line: 0,
        col: 0,
        endCol: placeholderText.length,
      },
    ],
    virtText: [],
    imagePlacements: [],
    clickables: [
      {
        line: 0,
        colStart: 0,
        colEnd: placeholderText.length,
        action: { type: "open_url", payload: command },
      },
    ],
  };

  // Phase 2: all image backends produce placeholder-only output.
  // US5 (T103) will populate SixelPlacement for caps.image === "sixel".
  return { fragment };
}
