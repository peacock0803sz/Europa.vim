/**
 * Popup window helpers for Europa's floating viewer.
 *
 * @category View
 */

import type { Denops } from "@denops/std";

let _nextPopupId = 1;

/**
 * Open a popup/floating window and return its numeric id.
 *
 * Uses `popup_create` on Vim and `nvim_open_win` on Neovim. Falls back to a
 * module-level counter when the host returns `null` (e.g. in tests).
 *
 * @param host - Active Denops instance.
 * @param opts - Lines and optional window configuration.
 * @returns A numeric popup id suitable for `closePopup`.
 * @spec-id europa.view.popup.basic
 */
export async function openViewerPopup(
  host: Denops,
  opts: { lines: string[]; title?: string; width?: number; height?: number },
): Promise<number> {
  if (host.meta.host === "nvim") {
    const buf = (await host.call("nvim_create_buf", false, true)) as number;
    await host.call("nvim_buf_set_lines", buf, 0, -1, false, opts.lines);
    const width = opts.width ?? 60;
    const height = opts.height ?? Math.max(1, Math.min(opts.lines.length, 20));
    const win = (await host.call("nvim_open_win", buf, true, {
      relative: "editor",
      width,
      height,
      row: 1,
      col: 1,
      style: "minimal",
      border: "single",
      title: opts.title ?? "",
    })) as number | null;
    return typeof win === "number" ? win : _nextPopupId++;
  }
  const id = (await host.call("popup_create", opts.lines, {
    title: opts.title ?? "",
    wrap: true,
    close: "click",
  })) as number | null;
  return typeof id === "number" ? id : _nextPopupId++;
}

/**
 * Close a popup window previously opened by `openViewerPopup`.
 *
 * @param host - Active Denops instance.
 * @param popupId - The id returned by `openViewerPopup`.
 */
export async function closePopup(
  host: Denops,
  popupId: number,
): Promise<void> {
  if (host.meta.host === "nvim") {
    await host.call("nvim_win_close", popupId, true);
    return;
  }
  await host.call("popup_close", popupId);
}
