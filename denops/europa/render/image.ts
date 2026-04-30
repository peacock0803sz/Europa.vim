/**
 * Image renderer: produces a placeholder fragment for PNG/JPEG cell outputs.
 *
 * Synchronous by design — all Sixel I/O (ImageMagick subprocess, /dev/tty
 * write) lives in `view/viewer.ts` so the render layer stays a pure data
 * transform with no side-effects (DESIGN.md §3.7.5).
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type {
  ImageRenderResult,
  RenderFragment,
} from "../../../schema/render-plan.ts";

/**
 * Render an image cell output as a placeholder line, optionally returning
 * Sixel placement metadata for the viewer to apply.
 *
 * Always produces a `[image: <kind> <w>x<h> - :EuropaPreviewOutput ...]`
 * placeholder with `EuropaImagePlaceholder` highlight and a clickable.
 *
 * When `caps.image === "sixel"`, additionally returns a `placement` carrying
 * the raw base64 payload so `view/viewer.ts` can convert and write to the
 * terminal asynchronously. No subprocess is invoked here.
 *
 * @param data - Base64-encoded image bytes (PNG or JPEG).
 * @param mime - MIME type: `"image/png"` or `"image/jpeg"`.
 * @param caps - Host capabilities; `caps.image === "sixel"` activates the
 *   Sixel metadata path.
 * @param meta - Cell/output index and optional pixel dimensions.
 * @returns An `ImageRenderResult` with fragment and optional Sixel placement.
 * @spec-id europa.render.image.placeholder
 * @spec-id europa.render.image.sixel-metadata
 */
export function renderImage(
  data: string,
  mime: "image/png" | "image/jpeg",
  caps: Capabilities,
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

  // Sixel opt-in (FR-020): return placement metadata for the viewer layer.
  // No subprocess or I/O happens here — the render layer is synchronous.
  if (caps.image === "sixel") {
    return {
      fragment,
      placement: {
        line: 0,
        payload: data,
        mime,
        width: meta.width,
        height: meta.height,
        backend: "sixel",
        cellIdx: meta.cellIdx,
        outputIdx: meta.outputIdx,
      },
    };
  }

  return { fragment };
}
