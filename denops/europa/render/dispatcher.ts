/**
 * Output dispatcher: routes a cell output to the appropriate renderer.
 *
 * Selects the best MIME type from `mimePriority` and returns a RenderFragment.
 *
 * @category Render
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";
import type { RenderFragment } from "../../../schema/render-plan.ts";
import { renderError, renderStream, renderText } from "./text.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderJson } from "./json.ts";
import { renderHtml } from "./html.ts";

function renderMimeData(
  data: Record<string, unknown>,
  mimePriority: string[],
  _caps: Capabilities,
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

    // Image MIMEs: placeholder until US3 (T087)
    if (mime.startsWith("image/")) {
      return renderText(`[image: ${mime}]`);
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
 * @param output - The cell output to render.
 * @param caps - Host capabilities (reserved for image protocol selection).
 * @param mimePriority - Ordered list of preferred MIME types.
 * @returns A `RenderFragment` suitable for inclusion in a `RenderPlan`.
 * @spec-id europa.render.dispatcher.mime-priority
 */
export function dispatchOutput(
  output: Output,
  caps: Capabilities,
  mimePriority: string[],
): RenderFragment {
  if (output.output_type === "stream") {
    return renderStream(output.name, output.text);
  }

  if (output.output_type === "error") {
    return renderError(output.ename, output.evalue, output.traceback);
  }

  // execute_result and display_data both carry a data MIME bundle.
  const data = output.data as Record<string, unknown>;
  return renderMimeData(data, mimePriority, caps);
}
