/**
 * BDD specs for lint-no-default-mappings.ts.
 *
 * Verifies that plugin/mappings.vim contains only `<Plug>(europa-*)` lhs
 * values and defines all 9 required mappings.
 *
 * @spec-id europa.lint.no-default-mappings
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { findDefaultMappingViolations } from "../../scripts/lint-no-default-mappings.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const MAPPINGS_FILE = join(REPO_ROOT, "plugin/mappings.vim");

describe("lint: plugin/mappings.vim — no default key mappings", () => {
  it("plugin/mappings.vim exists", async () => {
    let stat: Deno.FileInfo | undefined;
    try {
      stat = await Deno.stat(MAPPINGS_FILE);
    } catch {
      stat = undefined;
    }
    assertEquals(
      stat !== undefined && stat.isFile,
      true,
      `plugin/mappings.vim must exist at ${MAPPINGS_FILE}`,
    );
  });

  it("all map lhs values start with <Plug>(europa-", async () => {
    const content = await Deno.readTextFile(MAPPINGS_FILE);
    const violations = findDefaultMappingViolations(content);
    assertEquals(
      violations,
      [],
      violations.length > 0
        ? `Found ${violations.length} non-Plug mapping(s):\n` +
          violations
            .map((v) => `  line ${v.lineNo}: lhs='${v.lhs}' — ${v.line}`)
            .join("\n")
        : "",
    );
  });

  it("defines all 9 required <Plug>(europa-*) mappings", async () => {
    const content = await Deno.readTextFile(MAPPINGS_FILE);
    const required = [
      "<Plug>(europa-insert-code)",
      "<Plug>(europa-insert-markdown)",
      "<Plug>(europa-insert-raw)",
      "<Plug>(europa-delete-cell)",
      "<Plug>(europa-cell-up)",
      "<Plug>(europa-cell-down)",
      "<Plug>(europa-edit-cell)",
      "<Plug>(europa-split-cell)",
      "<Plug>(europa-join-cell)",
    ];
    for (const plug of required) {
      assertEquals(
        content.includes(plug),
        true,
        `plugin/mappings.vim must define ${plug}`,
      );
    }
  });
});
