/**
 * Image renderer: produces a placeholder fragment for PNG/JPEG cell outputs.
 *
 * Synchronous by design — all Sixel I/O (ImageMagick subprocess, /dev/tty
 * write) lives in `view/viewer.ts` so the render layer stays a pure data
 * transform with no side-effects (DESIGN.md §3.7.5).
 *
 * @category Render
 */

import { decodeBase64 } from "@std/encoding/base64";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type {
  ImageRenderResult,
  RenderFragment,
} from "../../../schema/render-plan.ts";

// 16px is used because the spacer estimate must under-shoot real cell
// height rather than over-shoot — a value too large produces too few
// reserved rows and lets the Sixel image overlay subsequent cells, while
// a too-small value only adds a few extra blank lines.  WezTerm /
// Ghostty / iTerm2 with default fonts sit around 16-22px on Retina
// displays, so 16 reserves enough rows for the common case.  The
// constant is a module-private fallback; the per-render override comes
// in via `meta.cellHeightPx` so callers can plumb a configured value
// (e.g. `g:europa_sixel_cell_height_px`) when they have one.
const SIXEL_CELL_HEIGHT_PX = 16;

/**
 * Read pixel dimensions from a base64-encoded PNG header.
 *
 * PNG layout: 8-byte signature, then the IHDR chunk (4 bytes length + 4 bytes
 * type "IHDR" + 4 bytes width + 4 bytes height, both big-endian uint32).
 * Returns `undefined` when the input is not a valid PNG header — JPEG and
 * other formats fall through and the caller substitutes a default.
 */
export function pngDimensions(
  b64: string,
): { width: number; height: number } | undefined {
  try {
    const bytes = decodeBase64(b64.slice(0, 64));
    if (bytes.length < 24) return undefined;
    if (
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      return undefined;
    }
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  } catch {
    return undefined;
  }
}

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
  meta: {
    cellIdx: number;
    outputIdx: number;
    width?: number;
    height?: number;
    cellHeightPx?: number;
  },
): ImageRenderResult {
  const kind = mime === "image/png" ? "png" : "jpeg";
  const w = meta.width !== undefined ? String(meta.width) : "?";
  const h = meta.height !== undefined ? String(meta.height) : "?";
  const command = `:EuropaPreviewOutput ${meta.cellIdx} ${meta.outputIdx}`;
  const placeholderText = `[image: ${kind} ${w}x${h} - ${command}]`;

  const lines = [placeholderText];

  // For Sixel backend we must reserve buffer rows beneath the placeholder
  // so the inline image does not visually overlay the next cell's content
  // (terminal Sixel images are drawn as a graphics layer over the text
  // grid and would otherwise hide whatever buffer text sits below them).
  if (caps.image === "sixel") {
    const pixelHeight = meta.height ?? pngDimensions(data)?.height;
    const cellHeight = meta.cellHeightPx && meta.cellHeightPx > 0
      ? meta.cellHeightPx
      : SIXEL_CELL_HEIGHT_PX;
    // Default to 16 spacer rows when the pixel height cannot be determined
    // because JPEG / unparsable inputs fall through here and a generous
    // default must be used to avoid overlaying subsequent cells.
    const rows = pixelHeight ? Math.ceil(pixelHeight / cellHeight) : 16;
    for (let i = 0; i < rows; i++) lines.push("");
  }

  const fragment: RenderFragment = {
    lines,
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
    mdDecorations: [],
  };

  // Sixel opt-in: return placement metadata for the viewer layer.
  // No subprocess or I/O happens here — the render layer is synchronous.
  // SVG → PNG conversion (Phase 3.6) feeds this branch via shadow-injected
  // image/png data — no code change needed here for SVG Sixel support.
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
