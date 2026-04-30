/**
 * CellMarker factory: returns the correct marker implementation for the host.
 *
 * @category View
 * @spec-id europa.view.cell-marker.factory
 */

import type { Denops } from "@denops/std";
import { NvimCellMarker } from "./cell-marker-nvim.ts";
import { VimCellMarker } from "./cell-marker-vim.ts";

/** Common interface for cell boundary markers across Vim and Neovim. */
export interface CellMarker {
  init(host: Denops): Promise<void>;
  setHead(bufnr: number, lnum: number, label: string): Promise<void>;
  setOutputBoundary(
    bufnr: number,
    lnum: number,
    label?: string,
  ): Promise<void>;
  clear(bufnr: number): Promise<void>;
  refresh(bufnr: number): Promise<void>;
}

// Singleton cache keyed on the Denops instance.
const _cache = new WeakMap<Denops, CellMarker>();

/**
 * Return (or create) the CellMarker for the given Denops host.
 *
 * The factory dispatches to `VimCellMarker` or `NvimCellMarker` based on
 * `host.meta.host` and caches the instance so repeated calls with the same
 * host object return the same marker.
 *
 * @spec-id europa.view.cell-marker.factory
 */
export function createCellMarker(host: Denops): CellMarker {
  if (_cache.has(host)) return _cache.get(host)!;
  const marker: CellMarker = host.meta.host === "nvim"
    ? new NvimCellMarker()
    : new VimCellMarker();
  _cache.set(host, marker);
  return marker;
}
