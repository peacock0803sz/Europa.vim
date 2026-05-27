/**
 * Pure notebook-mirror builder + line mapping (Phase 3.9).
 *
 * Concatenates every code cell (notebook order) into a single valid-Python
 * "mirror" so a standard LSP client sees the whole notebook as one module,
 * resolving cross-cell symbols naturally (FR-008). An inline suppression
 * header silences notebook-incompatible lint rules without writing a competing
 * config file; each cell is preceded by a `# %% <cellId>` boundary marker so
 * write-back can re-derive cell boundaries from the live buffer (FR-013), and
 * each source line is normalized (line count preserved) for a 1:1 cell↔mirror
 * mapping (FR-010 / FR-012a). Markdown / raw cells are excluded.
 *
 * Pure + synchronous: no I/O, no host RPC. The I/O layer (lsp/workspace.ts)
 * writes `text` to disk and pairs the result with paths.
 *
 * @category LSP
 * @module denops/europa/lsp/mirror
 */

import type { Notebook } from "../../../schema/notebook.ts";
import type { CellRegion, LineProvenance } from "../../../schema/session.ts";
import type { MirrorBuildResult } from "../../../contracts/europa-lsp-mirror.ts";
import { normalizeCell } from "./normalize.ts";

export type { MirrorBuildResult };

/**
 * Inline suppression header placed at the very top of every mirror. Silences
 * the unused-/pointless-expression rules that a notebook's trailing bare
 * expressions (`df`) would otherwise trip, while inheriting the user's project
 * pyright/ruff config + venv (no competing config file is written, research §2).
 */
const SUPPRESSION_HEADER: readonly string[] = [
  "# pyright: reportUnusedExpression=false",
  "# ruff: noqa: B018, B015",
];

/**
 * Build the whole mirror text + cellRegions + lineProvenance from a notebook.
 *
 * @spec-id europa.lsp.mirror.build
 */
export function buildMirror(notebook: Notebook): MirrorBuildResult {
  const lines: string[] = [];
  const lineProvenance: LineProvenance[] = [];
  const cellRegions: CellRegion[] = [];

  for (const header of SUPPRESSION_HEADER) {
    lines.push(header);
    lineProvenance.push("header");
  }

  for (const cell of notebook.cells) {
    if (cell.cell_type !== "code") continue;
    const markerLine = lines.length;
    lines.push(`# %% ${cell.id}`);
    lineProvenance.push("marker");

    const startLine = lines.length;
    const { lines: cellLines, provenance } = normalizeCell(cell.source);
    for (let i = 0; i < cellLines.length; i++) {
      lines.push(cellLines[i]);
      lineProvenance.push(provenance[i]);
    }
    cellRegions.push({
      cellId: cell.id,
      markerLine,
      startLine,
      // `endLine` is the last content line, inclusive; an empty cell still
      // emits one (empty) content line so `endLine === startLine`.
      endLine: lines.length - 1,
    });
  }

  return { text: lines.join("\n"), cellRegions, lineProvenance };
}

/**
 * Reverse-map a 0-based mirror line to its owning cell + in-cell line, or
 * `null` for a marker / header / out-of-range line (FR-010).
 *
 * @spec-id europa.lsp.mirror.linemap
 */
export function mapMirrorLineToCell(
  regions: readonly CellRegion[],
  line: number,
): { cellId: string; cellLine: number } | null {
  for (const region of regions) {
    if (line >= region.startLine && line <= region.endLine) {
      return { cellId: region.cellId, cellLine: line - region.startLine };
    }
  }
  return null;
}

/**
 * Forward-map a cell + in-cell line to its 0-based mirror line, or `null` when
 * the cell is not mirrored (e.g. markdown) or the line is out of range
 * (FR-005a region focus).
 */
export function mapCellLineToMirror(
  regions: readonly CellRegion[],
  cellId: string,
  cellLine: number,
): number | null {
  const region = regions.find((r) => r.cellId === cellId);
  if (region === undefined) return null;
  const target = region.startLine + cellLine;
  if (target < region.startLine || target > region.endLine) return null;
  return target;
}
