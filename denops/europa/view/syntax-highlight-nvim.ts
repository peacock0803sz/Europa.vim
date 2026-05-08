/**
 * Neovim tree-sitter syntax highlighter — candidate β implementation.
 *
 * Uses `vim.treesitter.get_string_parser` + `nvim_buf_add_highlight` to apply
 * per-cell language highlights without requiring a root-level parser for the
 * `europa` filetype (candidate α failed with "No parser for language europa").
 *
 * This file is a STUB — concrete bodies will be wired in T016 once the
 * T001b spike confirms candidate β meets SC-001 / SC-003 performance targets.
 * spec-ids (nvim-attach / nvim-refresh / lazy-visible-first) will be added
 * in T016 alongside the spec coverage for those behaviours.
 *
 * @module denops/europa/view/syntax-highlight-nvim
 */

import type { Denops } from "@denops/std";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";

export class NvimSyntaxHighlighter implements SyntaxHighlighter {
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
