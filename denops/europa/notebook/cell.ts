/**
 * Cell-level helpers: id assignment and source joining.
 *
 * @category Notebook
 * @spec-id europa.notebook.cell.assign-id
 * @spec-id europa.notebook.cell.join-source
 */

import { v7 } from "@std/uuid";

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
