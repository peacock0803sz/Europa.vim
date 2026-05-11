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

// Lua helper registered on `_G.europa_apply_highlights` at init time and
// invoked per cell range via `luaeval(expr, args)` (where `args` lands as
// `_A` inside the expression).
//
// We must register-then-invoke instead of `nvim_exec_lua(code, args)` because
// `nvim_exec_lua` is a Neovim API method that is NOT exposed as a Vimscript
// function. `denops.call(...)` dispatches through `nvim_call_function`, which
// only resolves Vimscript builtins, so calling it that way fails with E117.
// `luaeval` IS a Vimscript builtin, so it reaches the Lua runtime safely.
//
// The definition is collapsed to one line because `denops.cmd("lua ...")`
// sends a single Vim command line and Lua's grammar tolerates whitespace
// statement separation.
const REGISTER_HIGHLIGHTS_FN_LUA =
  "function _G.europa_apply_highlights(bufnr, sl, el, lang, ns) " +
  "local lines = vim.api.nvim_buf_get_lines(bufnr, sl, el, false) " +
  "local text = table.concat(lines, '\\n') " +
  "local ok, parser = pcall(vim.treesitter.get_string_parser, text, lang) " +
  "if not ok then return false end " +
  // parse(true) is needed so that injection trees become walkable children;
  // without the `true` flag, Neovim 0.12 leaves markdown_inline (and other
  // fence-language sub-parsers) lazy and our `ltree:children()` recursion
  // finds nothing, which prevents inline-element highlights from rendering.
  "pcall(parser.parse, parser, true) " +
  "local applied = 0 " +
  "local function apply_tree(ltree) " +
  "local l = ltree:lang() " +
  "local ok2, query = pcall(vim.treesitter.query.get, l, 'highlights') " +
  "if ok2 and query then " +
  "for _, tree in ipairs(ltree:trees()) do " +
  "for id, node in query:iter_captures(tree:root(), text, 0, -1) do " +
  "local hl = '@' .. query.captures[id] " +
  "local sr, sc, er, ec = node:range() " +
  // nvim_buf_set_extmark must be used here because tree-sitter nodes can
  // span multiple lines (e.g. markdown atx_heading reports end_row =
  // start_row + 1, end_col = 0 since it includes the trailing newline).
  // nvim_buf_add_highlight is a single-row API and would collapse such
  // ranges to zero width, hiding the heading captures entirely.
  "if pcall(vim.api.nvim_buf_set_extmark, bufnr, ns, sl + sr, sc, { end_row = sl + er, end_col = ec, hl_group = hl, priority = 100 }) then " +
  "applied = applied + 1 " +
  "end " +
  "end end end " +
  "for _, child in pairs(ltree:children()) do apply_tree(child) end " +
  "end " +
  "apply_tree(parser) " +
  "return applied " +
  "end";

const INVOKE_HIGHLIGHTS_LUA_EXPR =
  "_G.europa_apply_highlights(_A[1], _A[2], _A[3], _A[4], _A[5])";

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
    // Register the Lua helper on _G so per-cell luaeval calls stay compact.
    await denops.cmd(`lua ${REGISTER_HIGHLIGHTS_FN_LUA}`);
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
          "luaeval",
          INVOKE_HIGHLIGHTS_LUA_EXPR,
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
        } else if (typeof result === "number") {
          // Lua returned the count of applied highlight extmarks; log it so the
          // debug channel can distinguish "0 captures matched" from "parser
          // unavailable" — both look identical in the rendered buffer.
          await this._debugLog(
            `tree-sitter: applied ${result} highlight(s) for lang=${range.language} (lines ${range.startLine}-${range.endLine})`,
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
      // Use console.debug (not console.warn) so denops routes the line through
      // its debug log channel instead of tagging it as a warning; the
      // `g:denops#debug` gate still controls emission.
      if (flag) console.debug(`[europa] ${msg}`);
    } catch {
      // best-effort debug logging
    }
  }
}
