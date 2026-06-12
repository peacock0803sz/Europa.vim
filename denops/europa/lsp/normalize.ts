/**
 * Pure cell-source normalization for the notebook mirror (Phase 3.9).
 *
 * Why: a notebook cell may contain syntax that is invalid as plain Python —
 * line magic (`%timeit`), shell escape (`!pip`), help (`obj?`), or a whole
 * cell-magic body (`%%bash` ...). Left as-is they break the mirror's parse and
 * cascade lint errors across unrelated cells. Commenting them out (without
 * removing the line, so cell line K still maps 1:1 to a mirror line) keeps the
 * mirror valid Python while staying reversible via per-line provenance, so the
 * saved `.ipynb` keeps the original notation (FR-012a–d, nbformat-pristine).
 *
 * @category LSP
 * @module denops/europa/lsp/normalize
 */

import type { LineProvenance } from "../../../schema/session.ts";

// Line magic: first non-blank char is `%` but not `%%` (e.g. `%timeit foo()`).
const LINE_MAGIC_RE = /^\s*%(?!%)/;
// Shell escape: leading `!` (e.g. `!pip install x`).
const SHELL_ESCAPE_RE = /^\s*!/;
// Help: the WHOLE line is a name expression + `?`/`??` (`obj?`, `np.array??`).
// Anchored so code merely ending with `?` is not hidden from the LSP server.
const HELP_RE = /^\s*[\w.]+\?\??\s*$/;
// Cell magic: the cell's first non-blank line starts with `%%` (e.g. `%%bash`).
const CELL_MAGIC_RE = /^\s*%%/;

/** Comment a line out, preserving leading indentation and the line itself. */
function commentLine(line: string): string {
  return line.replace(/^(\s*)/, "$1# ");
}

/**
 * Normalize a cell's source into valid Python, preserving line count.
 *
 * Returns one entry per input line; `lines.length === provenance.length`
 * always equals the input line count (1:1 cell↔mirror mapping). An empty or
 * whitespace-only cell yields exactly one (possibly empty) content line.
 *
 * @spec-id europa.lsp.mirror.normalize
 */
export function normalizeCell(
  source: string,
): { lines: string[]; provenance: LineProvenance[] } {
  const srcLines = source.split("\n");
  const firstNonBlank = srcLines.find((l) => l.trim() !== "");
  const isCellMagic = firstNonBlank !== undefined &&
    CELL_MAGIC_RE.test(firstNonBlank);

  const lines: string[] = [];
  const provenance: LineProvenance[] = [];
  for (const line of srcLines) {
    const isMagic = isCellMagic ||
      LINE_MAGIC_RE.test(line) ||
      SHELL_ESCAPE_RE.test(line) ||
      HELP_RE.test(line);
    if (isMagic) {
      lines.push(commentLine(line));
      provenance.push({ kind: "magic", original: line });
    } else {
      lines.push(line);
      provenance.push("content");
    }
  }
  return { lines, provenance };
}

/**
 * De-normalize one mirror buffer line back to its cell source line, or drop it
 * (the inverse of {@link normalizeCell}, applied per line at write-back time).
 *
 * - `"content"` → the buffer line verbatim (user edits respected).
 * - `"marker"` / `"header"` → `null` (never written back to a cell).
 * - `{ kind: "magic", original }` → restore `original` iff the buffer line is
 *   still the normalized form of `original` (= untouched); otherwise keep the
 *   buffer line (the user edited the commented line).
 */
export function denormalizeLine(
  bufferLine: string,
  prov: LineProvenance,
): string | null {
  if (prov === "marker" || prov === "header") return null;
  if (prov === "content") return bufferLine;
  return bufferLine === commentLine(prov.original) ? prov.original : bufferLine;
}
