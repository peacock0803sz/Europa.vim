/**
 * Output dispatcher: routes a cell output to the appropriate renderer.
 * Also provides the cell execution state sign helper (renderCellExecState).
 *
 * Selects the best MIME type from `mimePriority` and returns a RenderFragment.
 *
 * @category Render
 * @spec-id europa.render.image.unsupported-mime
 * @spec-id europa.render.image.svg-source
 */

import type { Denops } from "@denops/std";
import { detectCapabilities } from "../capabilities.ts";
import type { CellExecState } from "../../../schema/session.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";
import type {
  RenderFragment,
  SixelPlacement,
} from "../../../schema/render-plan.ts";
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
  sixelAcc?: SixelPlacement[],
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
      const imgResult = renderImage(rawData, imgMime, caps, {
        ...meta,
        width,
        height,
      });
      if (imgResult.placement && sixelAcc) sixelAcc.push(imgResult.placement);
      return imgResult.fragment;
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
  sixelAcc?: SixelPlacement[],
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
  }, sixelAcc);
}

// Sign name + display text + highlight group for each non-idle exec state.
const CELL_SIGN_CONFIG = {
  busy: { name: "EuropaCellBusy", text: "*", hl: "EuropaCellBusyHl" },
  queued: { name: "EuropaCellQueued", text: "…", hl: "EuropaCellQueuedHl" },
  aborted: { name: "EuropaCellAborted", text: "!", hl: "EuropaCellAbortedHl" },
} as const;

// Neovim extmark ids per buffer+cell so idle state can remove them.
const _nvimMarkIds = new Map<string, number>();

/**
 * Register the three cell execution state signs for the current host.
 *
 * Vim: defines EuropaCellBusy / EuropaCellQueued / EuropaCellAborted via sign_define.
 * Neovim: creates the `europa_cell_exec` namespace via nvim_create_namespace.
 *
 * Idempotent: sign_define redefines safely; nvim_create_namespace returns the
 * same id for the same name, so repeated calls are harmless.
 */
export async function initCellExecSigns(denops: Denops): Promise<void> {
  const caps = await detectCapabilities(denops);
  if (caps.host === "vim") {
    for (const cfg of Object.values(CELL_SIGN_CONFIG)) {
      await denops.call("sign_define", cfg.name, {
        text: cfg.text,
        texthl: cfg.hl,
      });
    }
  } else {
    await denops.call("nvim_create_namespace", "europa_cell_exec");
  }
}

/**
 * Update the cell execution state sign in the sign column.
 *
 * Vim: sign group `europa_cell_{cellId}` isolates per-cell placement so
 * sign_unplace(group) removes the sign without needing a stored sign id.
 *
 * Neovim: nvim_buf_set_extmark with sign_text; the extmark id is cached in
 * _nvimMarkIds for subsequent removal when state transitions to idle.
 *
 * @param lnum - 1-indexed buffer line for the cell header (required for
 *               non-idle states; omitting skips placement silently).
 * @spec-id europa.render.cell-exec-state-sign
 */
export async function renderCellExecState(
  denops: Denops,
  bufnr: number,
  cellId: string,
  state: CellExecState,
  lnum?: number,
): Promise<void> {
  const caps = await detectCapabilities(denops);
  const group = `europa_cell_${cellId}`;
  const markKey = `${bufnr}:${cellId}`;

  if (state === "idle") {
    if (caps.host === "vim") {
      await denops.call("sign_unplace", group, { buffer: bufnr });
    } else {
      // Retrieve namespace id (idempotent, same name → same id).
      const ns = await denops.call(
        "nvim_create_namespace",
        "europa_cell_exec",
      ) as number;
      const markId = _nvimMarkIds.get(markKey);
      if (markId !== undefined) {
        await denops.call("nvim_buf_del_extmark", bufnr, ns, markId);
        _nvimMarkIds.delete(markKey);
      }
    }
    return;
  }

  const cfg = CELL_SIGN_CONFIG[state as keyof typeof CELL_SIGN_CONFIG];
  if (!cfg || lnum === undefined) return;

  if (caps.host === "vim") {
    await denops.call("sign_place", 0, group, cfg.name, bufnr, { lnum });
  } else {
    const ns = await denops.call(
      "nvim_create_namespace",
      "europa_cell_exec",
    ) as number;
    const existing = _nvimMarkIds.get(markKey);
    if (existing !== undefined) {
      await denops.call("nvim_buf_del_extmark", bufnr, ns, existing);
    }
    const newId = await denops.call(
      "nvim_buf_set_extmark",
      bufnr,
      ns,
      lnum - 1,
      0,
      { sign_text: cfg.text, sign_hl_group: cfg.hl },
    ) as number;
    _nvimMarkIds.set(markKey, newId);
  }
}
