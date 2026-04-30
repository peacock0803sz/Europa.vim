/**
 * HTML renderer: tag stripping and table-to-text conversion (Phase 2).
 *
 * Phase 4 will replace this with pandoc-based conversion. For Phase 2:
 * - `<style>` / `<script>` blocks (including their content) are removed
 * - `<table>` blocks are converted to a column-aligned text table with a
 *   dashed rule between header and body
 * - Remaining tags are stripped (entity decoding deferred to Phase 4)
 *
 * @category Render
 * @module html
 */

import type { RenderFragment } from "../../../schema/render-plan.ts";

/**
 * Extract `<tr>` rows from an HTML fragment as a 2D array of cell strings.
 * Each cell has nested tags removed and whitespace collapsed to single spaces.
 */
function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const trMatch of html.matchAll(trRe)) {
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    for (const cellMatch of trMatch[1].matchAll(cellRe)) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Convert the inner HTML of a `<table>` into a column-aligned text table.
 *
 * Format:
 * - Each cell renders as ` <value padded to colWidth> ` (1 space on each side)
 * - Cells are joined with `|`; a trailing `|` closes the row; no leading `|`
 * - A dashed rule of header-line length sits between header and body rows
 */
function tableToText(tableBody: string): string {
  const allRows = extractRows(tableBody);
  if (allRows.length === 0) return "";

  let headerCount = 1;
  const theadMatch = tableBody.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) {
    headerCount = extractRows(theadMatch[1]).length;
  }

  const nCols = Math.max(...allRows.map((r) => r.length));
  for (const row of allRows) {
    while (row.length < nCols) row.push("");
  }

  const widths = Array.from(
    { length: nCols },
    (_, c) => Math.max(...allRows.map((r) => r[c].length)),
  );

  const renderRow = (cells: string[]): string =>
    cells.map((v, c) => " " + v.padEnd(widths[c]) + " ").join("|") + "|";

  const lines: string[] = [];
  for (let i = 0; i < allRows.length; i++) {
    const line = renderRow(allRows[i]);
    lines.push(line);
    if (i === headerCount - 1 && allRows.length > headerCount) {
      lines.push("-".repeat(line.length));
    }
  }
  return lines.join("\n");
}

/**
 * Strip HTML tags and convert tables to text, returning a `RenderFragment`.
 *
 * @param html - Raw HTML string.
 * @returns `RenderFragment` with style/script blocks dropped, tables rendered
 *          as text, and remaining tags stripped.
 * @spec-id europa.render.html.tag-strip
 */
export function renderHtml(html: string): RenderFragment {
  const noBlocks = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const tablesReplaced = noBlocks.replace(
    /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
    (_, body) => tableToText(body),
  );
  const stripped = tablesReplaced.replace(/<[^>]+>/g, "");
  const lines = stripped.split("\n");
  return {
    lines,
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
  };
}
