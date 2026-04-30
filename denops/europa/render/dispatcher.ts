/**
 * Output dispatcher: routes a cell output to the appropriate renderer.
 *
 * Selects the best MIME type from `mimePriority` and returns a RenderFragment.
 *
 * @category Render
 * @spec-id europa.render.dispatcher.mime-priority
 */

import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";
import type { RenderFragment } from "../../../schema/render-plan.ts";

function emptyFragment(): RenderFragment {
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
  };
}

function linesFragment(lines: string[]): RenderFragment {
  return { ...emptyFragment(), lines };
}

function renderMimeData(
  data: Record<string, unknown>,
  mimePriority: string[],
): RenderFragment {
  for (const mime of mimePriority) {
    const value = data[mime];
    if (value === undefined) continue;

    if (mime === "text/plain" || mime === "text/markdown") {
      const text = Array.isArray(value) ? value.join("") : String(value);
      return linesFragment(text.split("\n"));
    }

    if (mime === "text/html") {
      const text = Array.isArray(value) ? value.join("") : String(value);
      return linesFragment(text.split("\n"));
    }

    if (mime === "application/json") {
      return linesFragment(JSON.stringify(value, null, 2).split("\n"));
    }

    if (mime.startsWith("image/")) {
      // Image rendering delegated to a later phase; emit placeholder.
      return linesFragment([`[image: ${mime}]`]);
    }

    return linesFragment([`[unsupported: ${mime}]`]);
  }

  return linesFragment(["[unsupported: no matching MIME]"]);
}

/**
 * Dispatch a single cell output to a `RenderFragment`.
 *
 * Stream and error outputs are handled directly. For `execute_result` and
 * `display_data`, the first MIME type in `mimePriority` that is present in
 * the output's `data` bundle is selected.
 *
 * @param output - The cell output to render.
 * @param _caps - Host capabilities (reserved for image protocol selection).
 * @param mimePriority - Ordered list of preferred MIME types.
 * @returns A `RenderFragment` suitable for inclusion in a `RenderPlan`.
 * @spec-id europa.render.dispatcher.mime-priority
 */
export function dispatchOutput(
  output: Output,
  _caps: Capabilities,
  mimePriority: string[],
): RenderFragment {
  if (output.output_type === "stream") {
    return linesFragment(output.text.split("\n"));
  }

  if (output.output_type === "error") {
    return linesFragment([
      `${output.ename}: ${output.evalue}`,
      ...output.traceback,
    ]);
  }

  // execute_result and display_data both carry a data MIME bundle.
  const data = output.data as Record<string, unknown>;
  return renderMimeData(data, mimePriority);
}
