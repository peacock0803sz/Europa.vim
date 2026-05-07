/**
 * Pure functions for taking and restoring structural notebook snapshots.
 *
 * `takeStructuralSnapshot` captures only the structural fields of a Notebook
 * (cell id / source / cell_type / metadata / order + notebook metadata),
 * deliberately excluding `cell.outputs` and `cell.execution_count` (FR-014a).
 *
 * `restoreStructural` merges a snapshot back onto a live notebook, preserving
 * the current `outputs` and `execution_count` of surviving cells. Cells that
 * were deleted (present in snapshot but absent from live) are resurrected with
 * empty outputs `[]` and `execution_count: null`.
 *
 * @module denops/europa/notebook/structural-snapshot
 * @category Notebook
 * @spec-id europa.notebook.structural-snapshot.take
 * @spec-id europa.notebook.structural-snapshot.restore-keep-outputs
 * @spec-id europa.notebook.structural-snapshot.restore-resurrect-empty-outputs
 * @spec-id europa.notebook.structural-snapshot.restore-keep-execution-count
 * @spec-id europa.notebook.structural-snapshot.restore-resurrect-null-execution-count
 */

import type { Cell, Notebook } from "../../../schema/notebook.ts";
import type {
  NotebookStructuralSnapshot,
  SnapshotCell,
} from "../../../contracts/undo-history.ts";

/**
 * Capture the structural-only snapshot of a notebook.
 *
 * Excludes `outputs` and `execution_count` from every cell. Uses explicit
 * field selection (not structuredClone) to keep snapshot size small and
 * make the exclusions machine-verifiable (FR-014a).
 */
export function takeStructuralSnapshot(
  notebook: Notebook,
): NotebookStructuralSnapshot {
  const cells: SnapshotCell[] = notebook.cells.map((cell) => {
    if (cell.cell_type === "code") {
      return {
        cell_type: "code",
        id: cell.id,
        source: cell.source,
        metadata: cell.metadata,
      };
    }
    if (cell.cell_type === "markdown") {
      const c: SnapshotCell = {
        cell_type: "markdown",
        id: cell.id,
        source: cell.source,
        metadata: cell.metadata,
      };
      if ("attachments" in cell && cell.attachments !== undefined) {
        (c as { attachments?: unknown }).attachments = cell.attachments;
      }
      return c;
    }
    // raw
    return {
      cell_type: "raw",
      id: cell.id,
      source: cell.source,
      metadata: cell.metadata,
    };
  });

  return {
    metadata: notebook.metadata,
    cells,
  };
}

/**
 * Merge a structural snapshot back onto a live notebook.
 *
 * For each cell in the snapshot:
 * - If the cell still exists in the live notebook: structural fields come from
 *   the snapshot; `outputs` and `execution_count` come from the live cell.
 * - If the cell was deleted (present in snapshot, absent from live): the cell
 *   is resurrected with `outputs: []` and `execution_count: null`.
 *
 * The cell order follows the snapshot order (structural rollback).
 * Notebook metadata is taken entirely from the snapshot.
 *
 * This is the merge logic mandated by FR-014a / Q-snapshot-merge (plan §).
 */
export function restoreStructural(
  currentNotebook: Notebook,
  snapshot: NotebookStructuralSnapshot,
): Notebook {
  // Build a lookup from cellId → live cell for O(1) access
  const liveById = new Map<string, Cell>();
  for (const cell of currentNotebook.cells) {
    liveById.set(cell.id, cell);
  }

  const cells: Cell[] = snapshot.cells.map((snapCell) => {
    const live = liveById.get(snapCell.id);

    if (snapCell.cell_type === "code") {
      const liveCode = live?.cell_type === "code" ? live : undefined;
      return {
        cell_type: "code",
        id: snapCell.id,
        source: snapCell.source,
        metadata: snapCell.metadata,
        // Keep live outputs / execution_count; resurrect with empty if deleted
        outputs: liveCode?.outputs ?? [],
        execution_count: liveCode?.execution_count ?? null,
      };
    }

    if (snapCell.cell_type === "markdown") {
      const result: Cell = {
        cell_type: "markdown",
        id: snapCell.id,
        source: snapCell.source,
        metadata: snapCell.metadata,
      };
      const snapMd = snapCell as {
        cell_type: "markdown";
        attachments?: Record<string, unknown>;
      };
      if (snapMd.attachments !== undefined) {
        (result as { attachments?: unknown }).attachments = snapMd.attachments;
      }
      return result;
    }

    // raw
    return {
      cell_type: "raw",
      id: snapCell.id,
      source: snapCell.source,
      metadata: snapCell.metadata,
    };
  });

  return {
    nbformat: currentNotebook.nbformat,
    nbformat_minor: currentNotebook.nbformat_minor,
    metadata: snapshot.metadata,
    cells,
  };
}
