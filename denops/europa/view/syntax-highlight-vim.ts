/**
 * Vim host no-op syntax highlighter.
 *
 * Implements `SyntaxHighlighter` as a complete no-op because Vim does not
 * expose a tree-sitter API at the script level. Existing border highlight
 * groups (`EuropaCellHeader` etc.) defined in `syntax/europa.vim` remain
 * active and are not touched by this implementation (R6 / Constitution V
 * cross-host parity exception).
 *
 * @spec-id europa.view.syntax-highlight.vim-noop
 * @module denops/europa/view/syntax-highlight-vim
 */

import type { Denops } from "@denops/std";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";

export class VimSyntaxHighlighter implements SyntaxHighlighter {
  init(_denops: Denops): Promise<void> {
    return Promise.resolve();
  }

  attach(_bufnr: number, _ranges: readonly CellLanguageRange[]): Promise<void> {
    return Promise.resolve();
  }

  refresh(
    _bufnr: number,
    _ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    return Promise.resolve();
  }

  detach(_bufnr: number): Promise<void> {
    return Promise.resolve();
  }
}
