/**
 * Output dispatcher: routes a cell output to the appropriate renderer.
 *
 * Selects the best MIME type from `mimePriority` and returns a RenderFragment.
 *
 * @category Render
 * @spec-id europa.render.image.unsupported-mime
 * @spec-id europa.render.image.svg-source
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";
import type { RenderFragment } from "../../../schema/render-plan.ts";
import { renderError, renderStream, renderText } from "./text.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderJson } from "./json.ts";
import { renderHtml } from "./html.ts";
import { renderImage } from "./image.ts";

function renderMimeData(
  data: Record<string, unknown>,
  outputMetadata: Record<string, unknown>,
  mimePriority: string[],
  caps: Capabilities,
  meta: { cellIdx: number; outputIdx: number },
): RenderFragment {
  for (const mime of mimePriority) {
    const value = data[mime];
    if (value === undefined) continue;

    const text = Array.isArray(value) ? value.join("") : String(value);

    if (mime === "text/plain") return renderText(text);
    if (mime === "text/markdown") return renderMarkdown(text);
    if (mime === "text/html") return renderHtml(text);
    if (mime === "application/json") return renderJson(value);

    // SVG source: display as plain text (FR-024)
    if (mime === "image/svg+xml") return renderText(text);

    // Image MIMEs: route through renderImage for placeholder + clickable (FR-018)
    if (mime === "image/png" || mime === "image/jpeg") {
      const imgMime = mime as "image/png" | "image/jpeg";
      const rawData = typeof value === "string" ? value : "";
      // nbformat stores per-MIME dimensions in output.metadata[mime], not output.data
      const imgMetaForMime = outputMetadata[mime] as
        | Record<string, unknown>
        | undefined;
      const width = typeof imgMetaForMime?.width === "number"
        ? imgMetaForMime.width
        : undefined;
      const height = typeof imgMetaForMime?.height === "number"
        ? imgMetaForMime.height
        : undefined;
      return renderImage(rawData, imgMime, caps, {
        ...meta,
        width,
        height,
      }).fragment;
    }

    // Unsupported MIME (FR-025)
    return renderText(`[unsupported MIME: ${mime}]`);
  }

  return renderText("[unsupported: no matching MIME]");
}

/**
 * Dispatch a single cell output to a `RenderFragment`.
 *
 * Stream and error outputs are handled directly. For `execute_result` and
 * `display_data`, the first MIME type in `mimePriority` that is present in
 * the output's `data` bundle is selected.
 *
 * Image MIMEs (`image/png`, `image/jpeg`) are routed to `renderImage` which
 * produces a `[image: ...]` placeholder with a clickable `:EuropaPreviewOutput`
 * command. SVG source is displayed as plain text (FR-024). Unsupported MIMEs
 * produce a `[unsupported MIME: ...]` placeholder (FR-025).
 *
 * @param output - The cell output to render.
 * @param caps - Host capabilities used for image backend selection.
 * @param mimePriority - Ordered list of preferred MIME types.
 * @param meta - Optional cell/output indices for image placeholder commands.
 * @returns A `RenderFragment` suitable for inclusion in a `RenderPlan`.
 * @spec-id europa.render.dispatcher.mime-priority
 */
export function dispatchOutput(
  output: Output,
  caps: Capabilities,
  mimePriority: string[],
  meta: { cellIdx?: number; outputIdx?: number } = {},
): RenderFragment {
  if (output.output_type === "stream") {
    return renderStream(output.name, output.text);
  }

  if (output.output_type === "error") {
    return renderError(output.ename, output.evalue, output.traceback);
  }

  // execute_result and display_data both carry a data MIME bundle.
  // output.metadata[mime] holds per-MIME dimension metadata (nbformat spec).
  const data = output.data as Record<string, unknown>;
  const outputMetadata = output.metadata as Record<string, unknown>;
  return renderMimeData(data, outputMetadata, mimePriority, caps, {
    cellIdx: meta.cellIdx ?? 0,
    outputIdx: meta.outputIdx ?? 0,
  });
}
