/**
 * BDD specs for defineHighlights.
 *
 * @spec-id europa.view.highlight.defaults
 * @spec-id europa.view.highlight.idempotent
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { mockVim } from "../../fixtures/mock-host.ts";
import {
  defineHighlights,
  HIGHLIGHT_GROUPS,
} from "../../../denops/europa/view/highlight.ts";

const EXPECTED_GROUPS = [
  "EuropaCellHeader",
  "EuropaCellFooter",
  "EuropaCellSource",
  "EuropaCellMarkdown",
  "EuropaOutput",
  "EuropaError",
  "EuropaStream",
  "EuropaStreamErr",
  "EuropaImagePlaceholder",
];

describe("defineHighlights — hl_group definitions", () => {
  it("defines all 9 Europa* highlight groups via hi default link", async () => {
    const denops = mockVim();
    await defineHighlights(denops);

    for (const group of EXPECTED_GROUPS) {
      const found = denops.cmdsMatching(`hi default link ${group}`).length > 0;
      assertEquals(
        found,
        true,
        `Expected 'hi default link ${group}' to be called`,
      );
    }
  });

  it("exports the HIGHLIGHT_GROUPS constant listing all 9 groups", () => {
    assertEquals(HIGHLIGHT_GROUPS.length, 9);
    for (const g of EXPECTED_GROUPS) {
      assertEquals(
        (HIGHLIGHT_GROUPS as readonly string[]).includes(g),
        true,
        `Missing: ${g}`,
      );
    }
  });
});

describe("defineHighlights — idempotency", () => {
  it("can be called twice without error (idempotent)", async () => {
    const denops = mockVim();
    await defineHighlights(denops);
    await defineHighlights(denops);
    // No exception thrown — idempotent by design (hi default link is a no-op if already set)
    assertEquals(true, true);
  });
});
