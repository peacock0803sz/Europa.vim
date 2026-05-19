/**
 * Highlight group definitions for the Europa viewer.
 *
 * Defines all `Europa*` hl_groups using `hi default link` so colorscheme
 * authors can override them. Calling `defineHighlights` multiple times is
 * safe — `hi default link` is a no-op when the group already has a non-default
 * definition (DESIGN.md 11.6).
 *
 * @category View
 */

import type { Denops } from "@denops/std";

/** All Europa highlight group names (Phase 2 viewer + Phase 009 execution-state + Phase 3.7 markdown overlay). */
export const HIGHLIGHT_GROUPS = [
  "EuropaCellHeader",
  "EuropaCellFooter",
  "EuropaCellSource",
  "EuropaCellMarkdown",
  "EuropaOutput",
  "EuropaError",
  "EuropaStream",
  "EuropaStreamErr",
  "EuropaImagePlaceholder",
  // Phase 009: execution-state indicator groups (FR-003)
  "EuropaCellBusyHl",
  "EuropaCellQueuedHl",
  "EuropaCellAbortedHl",
  // Phase 3.7: markdown inline overlay groups (FR-005, R7)
  "EuropaMdBold",
  "EuropaMdItalic",
  "EuropaMdLink",
  "EuropaMdCode",
  "EuropaMdListMarker",
  "EuropaMdQuote",
  "EuropaMdRule",
  "EuropaMdStrike",
  "EuropaMdFenceLang",
] as const;

type HighlightGroup = typeof HIGHLIGHT_GROUPS[number];

/** Default link targets for each Europa group. */
const LINKS: Record<HighlightGroup, string> = {
  EuropaCellHeader: "Comment",
  EuropaCellFooter: "Comment",
  EuropaCellSource: "Normal",
  EuropaCellMarkdown: "Title",
  EuropaOutput: "Normal",
  EuropaError: "ErrorMsg",
  EuropaStream: "Normal",
  EuropaStreamErr: "WarningMsg",
  EuropaImagePlaceholder: "Special",
  EuropaCellBusyHl: "WarningMsg",
  EuropaCellQueuedHl: "Comment",
  EuropaCellAbortedHl: "ErrorMsg",
  EuropaMdBold: "Bold",
  EuropaMdItalic: "Italic",
  EuropaMdLink: "Underlined",
  EuropaMdCode: "String",
  EuropaMdListMarker: "Statement",
  EuropaMdQuote: "Comment",
  EuropaMdRule: "Special",
  EuropaMdStrike: "NonText",
  EuropaMdFenceLang: "Type",
};

/**
 * Define all Europa highlight groups via `hi default link`.
 *
 * Safe to call multiple times — `hi default link` leaves user-defined
 * colorscheme overrides untouched.
 *
 * @param denops - Denops instance for issuing Vim commands.
 * @spec-id europa.view.highlight.defaults
 * @spec-id europa.view.highlight.idempotent
 */
export async function defineHighlights(denops: Denops): Promise<void> {
  for (const group of HIGHLIGHT_GROUPS) {
    await denops.cmd(`hi default link ${group} ${LINKS[group]}`);
  }
}
