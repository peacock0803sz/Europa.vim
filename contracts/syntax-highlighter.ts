/**
 * Behavioral contract for the Europa syntax highlighter.
 *
 * `SyntaxHighlighter` is a hand-written interface (whitelist exception to
 * Constitution I) because the factory pattern with `Promise<void>` return
 * types and an opaque host-side handle cannot be expressed as a TypeBox
 * schema. See DESIGN.md §3.7.3 for the same rationale used by `CellMarker`.
 *
 * @module contracts/syntax-highlighter
 */

import type { Denops } from "@denops/std";
import type { CellLanguageRange } from "../schema/highlight.ts";

export type { CellLanguageRange };

/**
 * Host-agnostic interface for partial syntax highlighting of an Europa buffer.
 *
 * Implementations:
 * - `NvimSyntaxHighlighter` — uses `vim.treesitter` `get_string_parser` with
 *   `nvim_buf_add_highlight`, one namespace per buffer (R1 candidate β).
 * - `VimSyntaxHighlighter` — no-op fallback that preserves existing border
 *   highlights only (R6).
 *
 * Both are constructed via `createSyntaxHighlighter(denops)` factory.
 */
export interface SyntaxHighlighter {
  /**
   * Initialize global host-side resources (highlight group definitions,
   * tree-sitter runtime presence probe). Per-buffer state is NOT created here;
   * that happens in `attach(bufnr, ranges)`. Idempotent — safe to call
   * multiple times. MUST NOT throw on missing tree-sitter runtime; failures
   * surface later via `attach` becoming a no-op.
   */
  init(denops: Denops): Promise<void>;

  /**
   * Begin highlighting `bufnr` with the given cell ranges. If a session
   * already exists for `bufnr`, it is replaced atomically (idempotent
   * re-attach). MUST NOT throw on parser load failures for individual
   * languages — affected cells are silently skipped (FR-006).
   *
   * @param bufnr - target buffer number
   * @param ranges - cell language ranges, in document order
   */
  attach(bufnr: number, ranges: readonly CellLanguageRange[]): Promise<void>;

  /**
   * Update an existing session's cell ranges (add/remove/move cells, language
   * change). If no session exists for `bufnr`, MUST behave as `attach`.
   *
   * @param bufnr - target buffer number
   * @param ranges - new cell language ranges, in document order
   */
  refresh(bufnr: number, ranges: readonly CellLanguageRange[]): Promise<void>;

  /**
   * Tear down the session for `bufnr` (BufWipeout etc.). MUST be safe to
   * call without a prior `attach` (no-op).
   */
  detach(bufnr: number): Promise<void>;
}
