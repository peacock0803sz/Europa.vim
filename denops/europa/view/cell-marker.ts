/**
 * CellMarker factory: returns the correct marker implementation for the host.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import type { CellMarker } from "../../../contracts/cell-marker.ts";
import { NvimCellMarker } from "./cell-marker-nvim.ts";
import { VimCellMarker } from "./cell-marker-vim.ts";

export type { CellMarker };

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
