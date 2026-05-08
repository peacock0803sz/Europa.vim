/**
 * Neovim tree-sitter syntax highlighter — candidate β implementation.
 *
 * Uses `vim.treesitter.get_string_parser` + `nvim_buf_add_highlight` to apply
 * per-cell language highlights without requiring a root-level parser for the
 * `europa` filetype (candidate α failed with "No parser for language europa").
 *
 * Candidate β flow for each CellLanguageRange:
 *   1. `nvim_buf_get_lines` extracts cell source text.
 *   2. `vim.treesitter.get_string_parser(text, lang)` builds a LanguageTree.
 *   3. `parser:parse()` triggers root parsing and populates injected subtrees
 *      (e.g., fenced code blocks in Markdown cells via `injections.scm`).
 *   4. `apply_tree` recurses through the LanguageTree and all `children()`,
 *      applying `highlights` query captures via `nvim_buf_add_highlight`.
 * All per-cell failures are isolated via Lua `pcall` guards (FR-006).
 *
 * @module denops/europa/view/syntax-highlight-nvim
 */

import type { Denops } from "@denops/std";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";

// Lua script executed per cell-range. Receives (bufnr, startLine, endLine,
// lang, nsId) as varargs. Returns true on success, false on any soft failure.
//
// The recursive `apply_tree` function walks the LanguageTree and all injected
// subtrees so that markdown fence blocks (e.g. ```python) receive highlights
// from the child language's parser without any TypeScript-side bookkeeping.
const APPLY_HIGHLIGHTS_LUA = `
local bufnr, sl, el, lang, ns = ...
local lines = vim.api.nvim_buf_get_lines(bufnr, sl, el, false)
local text = table.concat(lines, '\\n')
local ok, parser = pcall(vim.treesitter.get_string_parser, text, lang)
if not ok then return false end
parser:parse()
local function apply_tree(ltree)
  local l = ltree:lang()
  local ok2, query = pcall(vim.treesitter.query.get, l, 'highlights')
  if ok2 and query then
    for _, tree in ipairs(ltree:trees()) do
      for id, node in query:iter_captures(tree:root(), text, 0, -1) do
        local hl = '@' .. query.captures[id]
        local sr, sc, _, ec = node:range()
        pcall(vim.api.nvim_buf_add_highlight, bufnr, ns, hl, sl + sr, sc, ec)
      end
    end
  end
  for _, child in pairs(ltree:children()) do
    apply_tree(child)
  end
end
apply_tree(parser)
return true
`.trim();

/**
 * Neovim native tree-sitter syntax highlighter.
 *
 * One namespace (`Europa-tree-sitter`) is created globally on `init`; each
 * `attach` / `refresh` clears and re-fills that namespace for the target
 * buffer. Stores Denops on `init` so subsequent calls can issue Neovim API
 * calls without carrying Denops in their parameter lists (matches contract).
 *
 * @spec-id europa.view.syntax-highlight.nvim-attach
 * @spec-id europa.view.syntax-highlight.nvim-refresh
 * @spec-id europa.view.syntax-highlight.lazy-visible-first
 * @spec-id europa.view.syntax-highlight.markdown-attach
 * @spec-id europa.view.syntax-highlight.markdown-fence-injection
 * @spec-id europa.view.syntax-highlight.parser-missing
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
        const result = await this._host.call(
          "nvim_exec_lua",
          APPLY_HIGHLIGHTS_LUA,
          [
            bufnr,
            range.startLine,
            range.endLine,
            range.language,
            this._nsId,
          ],
        );
        // Lua returned false → parser unavailable (pcall caught it inside Lua)
        if (result === false) {
          await this._debugLog(
            `tree-sitter: parser unavailable for lang=${range.language}`,
          );
        }
      } catch (e) {
        // TypeScript-level failure (e.g. RPC error); same silent treatment
        await this._debugLog(
          `tree-sitter attach failed for lang=${range.language}: ${e}`,
        );
      }
    }
  }

  async refresh(
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    if (!this._host || this._nsId === undefined) return;
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
