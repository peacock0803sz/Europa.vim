/**
 * Behavioral contract for cell boundary markers.
 *
 * NOTE: unused in Phase 2 real-line border path; reserved for a possible virtual-line revival.
 *
 * `CellMarker` is a hand-written interface (whitelist exception to Constitution I)
 * because the factory pattern with `Promise<MarkerId>` return types cannot be
 * expressed as a TypeBox schema. See DESIGN.md §3.7.3.
 *
 * @module contracts/cell-marker
 */

import type { Denops } from "@denops/std";

/** Opaque marker identifier returned by `setHead` / `setOutputBoundary`. */
export type MarkerId = string | number;

/**
 * Host-agnostic interface for placing cell boundary decorations in a buffer.
 *
 * Vim implementation uses text properties; Neovim uses extmarks.
 * Both are created via `createCellMarker(denops)` factory.
 */
export interface CellMarker {
  /** Register marker types with the host. Idempotent. */
  init(denops: Denops): Promise<void>;
  /** Place a header marker above the given line. Returns the marker id. */
  setHead(
    bufnr: number,
    line: number,
    label: string,
  ): Promise<MarkerId>;
  /** Place an output boundary marker below the given line. */
  setOutputBoundary(
    bufnr: number,
    line: number,
    label?: string,
  ): Promise<MarkerId>;
  /** Remove markers. When ids are omitted, clears all markers in the buffer. */
  clear(bufnr: number, ids?: MarkerId[]): Promise<void>;
  /** Clear then re-place all markers for the buffer. */
  refresh(bufnr: number): Promise<void>;
}
