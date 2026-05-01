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
 * Returns the mutated notebook plus the newly assigned cellId, so callers do
 * not need to scan the result to locate the inserted cell. The original
 * notebook is unchanged. The new cell receives a uuid v7 id, empty source,
 * empty metadata, and — for code cells — `outputs: []` and
 * `execution_count: null`.
 *
 * Anchor semantics:
 * - Empty notebook (`cells.length === 0`): the anchor is ignored and the
 *   new cell becomes the only cell. `anchorCellId` may be `null`.
 * - Non-empty notebook: `anchorCellId` must be a valid existing cellId.
 *   Passing `null` is rejected so that callers cannot silently insert at a
 *   surprising position when their cursor-to-cell resolution failed.
 *
 * @param notebook - Source notebook (not mutated).
 * @param position - `"before"` inserts above the anchor, `"after"` below.
 * @param type - `"code"` | `"markdown"` | `"raw"`.
 * @param anchorCellId - The `cell.id` of the insertion anchor, or `null`
 *   only when the notebook is empty.
 * @returns Object with the new `notebook` and the inserted `cellId`.
 * @throws {Error} If `anchorCellId` is null on a non-empty notebook, or
 *   not found in `notebook.cells`.
 * @category Notebook
 * @spec-id europa.notebook.cell.insert
 */
export function insertCell(
  notebook: Notebook,
  position: "before" | "after",
  type: "code" | "markdown" | "raw",
  anchorCellId: string | null,
): { notebook: Notebook; cellId: string } {
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

  if (notebook.cells.length === 0) {
    return {
      notebook: { ...notebook, cells: [newCell] },
      cellId: newCell.id,
    };
  }
  if (anchorCellId === null) {
    throw new Error(
      "insertCell: anchorCellId is required when notebook has cells",
    );
  }
  const idx = notebook.cells.findIndex((c) => c.id === anchorCellId);
  if (idx === -1) {
    throw new Error(`insertCell: anchorCellId '${anchorCellId}' not found`);
  }
  const insertAt = position === "after" ? idx + 1 : idx;
  const cells = [
    ...notebook.cells.slice(0, insertAt),
    newCell,
    ...notebook.cells.slice(insertAt),
  ];
  return { notebook: { ...notebook, cells }, cellId: newCell.id };
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

/**
 * Swap a cell with its neighbour above (`up`) or below (`down`).
 *
 * Returns the original notebook unchanged (same reference) when the move is
 * a no-op — this lets callers detect the boundary case via `Object.is` and
 * surface an "Already at top" / "Already at bottom" guidance message
 * without needing a separate return signal. The same is true when `cellId`
 * is not found (FR-004).
 *
 * Untouched cells (those that are not part of the swap) keep their object
 * identity via structural sharing; only the two swapped cells change array
 * positions, never their internal state.
 *
 * @param notebook - Source notebook (not mutated).
 * @param cellId - The `cell.id` to move.
 * @param direction - `"up"` swaps with `cells[idx - 1]`; `"down"` with `cells[idx + 1]`.
 * @returns A new notebook with the cells reordered, or the original if the
 *   move is a no-op (boundary or unknown cellId).
 * @category Notebook
 * @spec-id europa.notebook.cell.move
 */
export function moveCell(
  notebook: Notebook,
  cellId: string,
  direction: "up" | "down",
): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === cellId);
  if (idx === -1) return notebook;
  if (direction === "up" && idx === 0) return notebook;
  if (direction === "down" && idx === notebook.cells.length - 1) {
    return notebook;
  }
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  const lo = Math.min(idx, swapWith);
  const hi = Math.max(idx, swapWith);
  const cells = [
    ...notebook.cells.slice(0, lo),
    notebook.cells[hi],
    notebook.cells[lo],
    ...notebook.cells.slice(hi + 1),
  ];
  return { ...notebook, cells };
}

/**
 * Split a cell into two consecutive cells at the given source line.
 *
 * The upper cell keeps the original `id` and — for code cells — its
 * `outputs` / `execution_count` / `metadata`. The lower cell is the same
 * `cell_type`, receives a fresh uuid v7 id, an empty `metadata`, and (for
 * code cells) `outputs = []` / `execution_count = null`. This keeps the
 * existing execution result tied to the upper half (where the original
 * code presumably still lives) while making the lower half a clean slate
 * the user can re-run.
 *
 * Boundary semantics:
 * - `splitLine = 0`: upper cell receives empty source, lower cell holds
 *   the entire original source (US4 AC6).
 * - `splitLine = sourceLineCount`: upper cell holds the entire source,
 *   lower cell is empty (R10 scenario 3).
 *
 * @param notebook - Source notebook (not mutated).
 * @param cellId - The `cell.id` to split.
 * @param splitLine - 0-origin line index in `cell.source.split("\n")`.
 * @returns A new notebook with the cell split into two consecutive cells.
 * @throws {Error} If `cellId` is not found, or `splitLine` is out of range
 *   (`< 0` or `> source.split("\n").length`).
 * @category Notebook
 * @spec-id europa.notebook.cell.split
 */
export function splitCell(
  notebook: Notebook,
  cellId: string,
  splitLine: number,
): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === cellId);
  if (idx === -1) {
    throw new Error(`splitCell: cellId '${cellId}' not found`);
  }
  const cell = notebook.cells[idx];
  const sourceLines = cell.source.split("\n");
  if (splitLine < 0 || splitLine > sourceLines.length) {
    throw new Error(
      `splitCell: splitLine ${splitLine} out of range [0, ${sourceLines.length}]`,
    );
  }
  const upperSource = sourceLines.slice(0, splitLine).join("\n");
  const lowerSource = sourceLines.slice(splitLine).join("\n");
  const upper: Cell = { ...cell, source: upperSource };
  const lower: Cell = cell.cell_type === "code"
    ? {
      cell_type: "code",
      id: assignCellId(),
      source: lowerSource,
      execution_count: null,
      outputs: [],
      metadata: {},
    }
    : cell.cell_type === "markdown"
    ? {
      cell_type: "markdown",
      id: assignCellId(),
      source: lowerSource,
      metadata: {},
    }
    : {
      cell_type: "raw",
      id: assignCellId(),
      source: lowerSource,
      metadata: {},
    };
  const cells = [
    ...notebook.cells.slice(0, idx),
    upper,
    lower,
    ...notebook.cells.slice(idx + 1),
  ];
  return { ...notebook, cells };
}

/**
 * Join the target cell with the cell immediately above it.
 *
 * The previous cell absorbs the target's source via `prev.source + "\n"
 * + curr.source`, and keeps its own `id` / `cell_type` / `outputs` /
 * `execution_count` / `metadata` (US4 AC4). The target cell is removed.
 * On mixed-type joins the previous cell's type wins, even if that means
 * markdown content gets concatenated into a code cell — the user opted
 * into this by triggering the join.
 *
 * Returns the original notebook unchanged (same reference) when the
 * target is the first cell or unknown — callers identity-check to
 * surface "No cell above to join" guidance without needing a separate
 * return signal.
 *
 * @param notebook - Source notebook (not mutated).
 * @param cellId - The `cell.id` of the target cell (the one being absorbed).
 * @returns A new notebook with the target merged into the previous cell,
 *   or the original notebook if the move is a no-op.
 * @category Notebook
 * @spec-id europa.notebook.cell.join
 */
export function joinCell(notebook: Notebook, cellId: string): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === cellId);
  if (idx <= 0) return notebook;
  const prev = notebook.cells[idx - 1];
  const curr = notebook.cells[idx];
  const merged: Cell = { ...prev, source: `${prev.source}\n${curr.source}` };
  const cells = [
    ...notebook.cells.slice(0, idx - 1),
    merged,
    ...notebook.cells.slice(idx + 1),
  ];
  return { ...notebook, cells };
}

/**
 * Replace the `source` of a single cell, leaving every other field intact.
 *
 * Used by the scratch edit buffer's `:write` handler (`saveCellEdit`) to
 * commit user edits back into the in-memory notebook without disturbing
 * outputs, execution_count, metadata, or surrounding cells.
 *
 * Returns the original notebook unchanged (same reference) when `cellId`
 * does not match — callers can identity-check to detect the miss.
 *
 * @param notebook - Source notebook (not mutated).
 * @param cellId - The `cell.id` whose source should change.
 * @param source - New source content for the matched cell.
 * @returns A new notebook with the source replaced, or the original if not found.
 * @category Notebook
 * @spec-id europa.notebook.cell.update-source
 */
export function updateCellSource(
  notebook: Notebook,
  cellId: string,
  source: string,
): Notebook {
  const idx = notebook.cells.findIndex((c) => c.id === cellId);
  if (idx === -1) return notebook;
  const newCell = { ...notebook.cells[idx], source };
  const cells = [
    ...notebook.cells.slice(0, idx),
    newCell,
    ...notebook.cells.slice(idx + 1),
  ];
  return { ...notebook, cells };
}
