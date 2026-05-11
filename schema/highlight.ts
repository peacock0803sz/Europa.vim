/**
 * TypeBox schema for Europa syntax-highlight feature types.
 *
 * This module is the Source of Truth (SoT 1) for highlight-related types.
 * `SyntaxHighlightModeSchema` drives the `g:europa_ts_highlight` config option.
 * `CellLanguageRangeSchema` is the transfer object passed to SyntaxHighlighter.
 *
 * @module schema/highlight
 */

import { type Static, Type } from "@sinclair/typebox";

/** User-facing tree-sitter highlight mode: auto-detect, force-on, or force-off. */
export const SyntaxHighlightModeSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("on"),
  Type.Literal("off"),
]);
export type SyntaxHighlightMode = Static<typeof SyntaxHighlightModeSchema>;

/** Cell kind eligible for tree-sitter highlighting. Raw cells are excluded (FR-004). */
export const CellKindSchema = Type.Union([
  Type.Literal("code"),
  Type.Literal("markdown"),
]);

/**
 * A single cell's source-text range for tree-sitter highlighting.
 *
 * Line numbers are 0-indexed half-open `[startLine, endLine)` matching the
 * end-exclusive convention of `nvim_buf_get_lines` and `nvim_buf_set_extmark`.
 * Header and output lines are excluded — only the cell body (source) is covered.
 */
export const CellLanguageRangeSchema = Type.Object({
  kind: CellKindSchema,
  language: Type.String(),
  startLine: Type.Integer({ minimum: 0 }),
  endLine: Type.Integer({ minimum: 0 }),
});
export type CellLanguageRange = Static<typeof CellLanguageRangeSchema>;
