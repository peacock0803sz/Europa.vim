/**
 * Cell-level helpers: id assignment, source joining, and pure cell mutations.
 *
 * @category Notebook
 */

import { v7 } from "@std/uuid";
import type { Cell, Notebook } from "../../../schema/notebook.ts";

/**
 * Generate a new uuid v7 cell id.
 *
 * UUID v7 encodes a millisecond-precision Unix timestamp in its first 48 bits,
 * making generated IDs time-ordered within the same process.
 *
 * @returns A uuid v7 string suitable for `cell.id`.
 * @spec-id europa.notebook.cell.assign-id
 */
export function assignCellId(): string {
  return v7.generate() as string;
}

/**
 * Validate that a string is a well-formed uuid v7.
 *
 * @param id - The cell id to check.
 * @returns `true` if `id` is a valid uuid v7.
 */
export function isValidCellId(id: string): boolean {
  return v7.validate(id);
}

/**
 * Normalise a cell source field to a plain string.
 *
 * Jupyter stores source as either a bare string or an array of strings
 * (each ending with `\n` except the last). Both forms are accepted; the
 * array form is joined with an empty separator per nbformat convention.
 *
 * @param source - Raw source value from a notebook cell.
 * @returns A single concatenated string.
 * @spec-id europa.notebook.cell.join-source
 */
export function joinSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}

/**
 * Insert a new empty cell of the given type relative to the anchor cell.
 *
 * Returns a new notebook with the inserted cell; the original is unchanged.
 * The new cell receives a uuid v7 id, empty source, empty metadata, and — for
 * code cells — `outputs: []` and `execution_count: null`.
 *
 * @param notebook - Source notebook (not mutated).
 * @param position - `"before"` inserts above the anchor, `"after"` below.
 * @param type - `"code"` | `"markdown"` | `"raw"`.
 * @param anchorCellId - The `cell.id` of the insertion anchor.
 * @returns A new notebook with the cell inserted.
 * @throws {Error} If `anchorCellId` is not found in `notebook.cells`.
 * @category Notebook
 * @spec-id europa.notebook.cell.insert
 */
export function insertCell(
  notebook: Notebook,
  position: "before" | "after",
  type: "code" | "markdown" | "raw",
  anchorCellId: string,
): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === anchorCellId);
  if (idx === -1) {
    throw new Error(`insertCell: anchorCellId '${anchorCellId}' not found`);
  }
  const newCell: Cell = type === "code"
    ? {
      cell_type: "code",
      id: assignCellId(),
      source: "",
      execution_count: null,
      outputs: [],
      metadata: {},
    }
    : type === "markdown"
    ? { cell_type: "markdown", id: assignCellId(), source: "", metadata: {} }
    : { cell_type: "raw", id: assignCellId(), source: "", metadata: {} };
  const insertAt = position === "after" ? idx + 1 : idx;
  const cells = [
    ...notebook.cells.slice(0, insertAt),
    newCell,
    ...notebook.cells.slice(insertAt),
  ];
  return { ...notebook, cells };
}

/**
 * Delete the cell with the given id.
 *
 * Returns the original notebook unchanged (same reference) if `cellId` is
 * not found — no-op semantics allow callers to detect the miss via identity
 * check and surface a warning without throwing.
 *
 * @param notebook - Source notebook (not mutated).
 * @param cellId - The `cell.id` to remove.
 * @returns A new notebook with the cell removed, or the original if not found.
 * @category Notebook
 * @spec-id europa.notebook.cell.delete
 */
export function deleteCell(notebook: Notebook, cellId: string): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === cellId);
  if (idx === -1) return notebook;
  const cells = [
    ...notebook.cells.slice(0, idx),
    ...notebook.cells.slice(idx + 1),
  ];
  return { ...notebook, cells };
}
