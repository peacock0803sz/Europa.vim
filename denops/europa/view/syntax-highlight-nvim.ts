/**
 * Neovim tree-sitter syntax highlighter — candidate β implementation.
 *
 * Uses `vim.treesitter.get_string_parser` + `nvim_buf_add_highlight` to apply
 * per-cell language highlights without requiring a root-level parser for the
 * `europa` filetype (candidate α failed with "No parser for language europa").
 *
 * Candidate β flow for each CellLanguageRange:
 *   1. `nvim_buf_get_lines` to extract cell source text.
 *   2. `vim.treesitter.get_string_parser(text, lang)` to parse in-memory.
 *   3. `vim.treesitter.query.get(lang, "highlights")` for the capture set.
 *   4. Iterate captures, offset by `range.startLine`, apply via
 *      `nvim_buf_add_highlight`.
 * Steps 2–4 run inside a single `nvim_exec_lua` call per range; pcall guards
 * isolate per-cell failures (FR-006).
 *
 * @module denops/europa/view/syntax-highlight-nvim
 */

import type { Denops } from "@denops/std";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";

// Lua script executed per cell-range. Receives (bufnr, startLine, endLine,
// lang, nsId) as varargs. Returns true on success, false on any soft failure.
const APPLY_HIGHLIGHTS_LUA = `
local bufnr, sl, el, lang, ns = ...
local lines = vim.api.nvim_buf_get_lines(bufnr, sl, el, false)
local text = table.concat(lines, '\n')
local ok, parser = pcall(vim.treesitter.get_string_parser, text, lang)
if not ok then return false end
local trees = parser:parse()
local tree = trees and trees[1]
if not tree then return false end
local ok2, query = pcall(vim.treesitter.query.get, lang, 'highlights')
if not ok2 or not query then return false end
for id, node in query:iter_captures(tree:root(), text, 0, -1) do
  local hl = '@' .. query.captures[id]
  local sr, sc, _, ec = node:range()
  pcall(vim.api.nvim_buf_add_highlight, bufnr, ns, hl, sl + sr, sc, ec)
end
return true
`.trim();

/**
 * Neovim native tree-sitter syntax highlighter.
 *
 * One namespace (`Europa-tree-sitter`) is created globally on `init`; each
 * `attach` / `refresh` clears and re-fills that namespace for the target
 * buffer. The Denops instance is stored on `init` so subsequent
 * `attach` / `refresh` / `detach` calls can issue Neovim API calls without
 * carrying `Denops` in their parameter lists (matching the `SyntaxHighlighter`
 * contract).
 *
 * @spec-id europa.view.syntax-highlight.nvim-attach
 * @spec-id europa.view.syntax-highlight.nvim-refresh
 * @spec-id europa.view.syntax-highlight.lazy-visible-first
 */
export class NvimSyntaxHighlighter implements SyntaxHighlighter {
  private _host?: Denops;
  private _nsId?: number;

  async init(denops: Denops): Promise<void> {
    this._host = denops;
    if (this._nsId !== undefined) return;
    this._nsId = (await denops.call(
      "nvim_create_namespace",
      "Europa-tree-sitter",
    )) as number;
  }

  async attach(
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    if (!this._host || this._nsId === undefined) return;
    for (const range of ranges) {
      if (!range.language) continue; // FR-011: skip cells with no resolved language
      try {
        await this._host.call("nvim_exec_lua", APPLY_HIGHLIGHTS_LUA, [
          bufnr,
          range.startLine,
          range.endLine,
          range.language,
          this._nsId,
        ]);
      } catch (e) {
        // FR-006: per-cell silent skip; log only when g:denops#debug is set
        await this._debugLog(
          `tree-sitter attach skipped cell (lang=${range.language}): ${e}`,
        );
      }
    }
  }

  async refresh(
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    if (!this._host || this._nsId === undefined) return;
    // Clear all existing highlights for this buffer before re-applying.
    await this._host.call("nvim_buf_clear_namespace", bufnr, this._nsId, 0, -1);
    await this.attach(bufnr, ranges);
  }

  async detach(bufnr: number): Promise<void> {
    if (!this._host || this._nsId === undefined) return;
    await this._host.call("nvim_buf_clear_namespace", bufnr, this._nsId, 0, -1);
  }

  private async _debugLog(msg: string): Promise<void> {
    if (!this._host) return;
    try {
      const flag = await this._host.eval("get(g:, 'denops#debug', 0)");
      if (flag) console.warn(`[europa] ${msg}`);
    } catch {
      // best-effort debug logging
    }
  }
}
