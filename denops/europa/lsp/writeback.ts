/**
 * Pure write-back distributor for the notebook mirror (Phase 3.9).
 *
 * Splits an edited mirror buffer back into per-cell sources. Cell boundaries
 * are re-derived from the LIVE `# %% <cellId>` markers in the edited buffer —
 * NOT from the build's fixed line offsets — so a ruff format or user edit that
 * inserts/removes lines inside a cell still routes each line to the correct
 * cell (FR-013). Untouched magic lines are restored to their original notation
 * via the build's provenance (when the block's line count is unchanged),
 * keeping the saved `.ipynb` nbformat-pristine (FR-016).
 *
 * Pure + synchronous: no I/O, no host RPC.
 *
 * @category LSP
 * @module denops/europa/lsp/writeback
 */

import type { LineProvenance } from "../../../schema/session.ts";
import type { MirrorBuildResult } from "../../../contracts/europa-lsp-mirror.ts";
import { denormalizeLine } from "./normalize.ts";

const MARKER_RE = /^# %% (.+)$/;

/**
 * Distribute the edited mirror buffer's lines back into per-cell sources, one
 * `{ cellId, source }` per code cell in buffer order.
 *
 * @param mirrorLines - The mirror buffer's current full contents (one per line).
 * @param build - The regions + provenance of the build the buffer was opened
 *                from (used to restore untouched magic lines). `text` is not
 *                needed, so LspMirrorState is accepted directly.
 * @spec-id europa.lsp.mirror.writeback
 */
export function distributeWriteBack(
  mirrorLines: readonly string[],
  build: Pick<MirrorBuildResult, "cellRegions" | "lineProvenance">,
): ReadonlyArray<{ cellId: string; source: string }> {
  // Per-cell provenance from the build (for restoring untouched magic lines).
  const provByCell = new Map<string, readonly LineProvenance[]>();
  for (const region of build.cellRegions) {
    provByCell.set(
      region.cellId,
      build.lineProvenance.slice(region.startLine, region.endLine + 1),
    );
  }

  // Re-scan live markers → blocks. Lines before the first marker (the
  // suppression header) are dropped.
  const blocks: { cellId: string; lines: string[] }[] = [];
  let current: { cellId: string; lines: string[] } | undefined;
  for (const line of mirrorLines) {
    const marker = MARKER_RE.exec(line);
    if (marker) {
      current = { cellId: marker[1], lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return blocks.map(({ cellId, lines }) => {
    const buildProv = provByCell.get(cellId);
    // Restore magic provenance positionally only when the line count is
    // unchanged; otherwise treat every line as edited content (verbatim).
    const sourceLines = buildProv && buildProv.length === lines.length
      ? lines.map((line, i) => denormalizeLine(line, buildProv[i]))
      : lines.map((line) => denormalizeLine(line, "content"));
    return {
      cellId,
      source: sourceLines.filter((l): l is string => l !== null).join("\n"),
    };
  });
}
