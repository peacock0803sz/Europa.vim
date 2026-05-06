/**
 * BDD specs for lint-no-default-mappings.ts.
 *
 * Verifies that plugin/mappings.vim contains only `<Plug>(europa-*)` lhs
 * values, defines the 12 baseline mappings (Phase 3.1 / 3.3), and the 9
 * argument-variant `<Plug>` mappings added on top — each bound to the
 * correct `:Europa...<CR>` rhs so empty stubs cannot regress.
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

  it("defines all 12 required <Plug>(europa-*) mappings", async () => {
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
      "<Plug>(europa-run-cell)",
      "<Plug>(europa-run-all)",
      "<Plug>(europa-cancel-cell)",
    ];
    for (const plug of required) {
      assertEquals(
        content.includes(plug),
        true,
        `plugin/mappings.vim must define ${plug}`,
      );
    }
  });

  it("binds argument-variant <Plug>(europa-*) mappings to their :Europa... commands", async () => {
    const content = await Deno.readTextFile(MAPPINGS_FILE);
    // Each entry asserts both presence of the lhs and that it is bound to
    // the expected rhs on the same line — guards against an empty stub
    // (e.g. `nnoremap <Plug>(europa-celltype-code) :<C-u><CR>`).
    const bindings: ReadonlyArray<{ plug: string; rhs: string }> = [
      {
        plug: "<Plug>(europa-insert-code-above)",
        rhs: ":<C-u>EuropaInsertCell! code<CR>",
      },
      {
        plug: "<Plug>(europa-insert-markdown-above)",
        rhs: ":<C-u>EuropaInsertCell! markdown<CR>",
      },
      {
        plug: "<Plug>(europa-insert-raw-above)",
        rhs: ":<C-u>EuropaInsertCell! raw<CR>",
      },
      {
        plug: "<Plug>(europa-celltype-code)",
        rhs: ":<C-u>EuropaCellType code<CR>",
      },
      {
        plug: "<Plug>(europa-celltype-markdown)",
        rhs: ":<C-u>EuropaCellType markdown<CR>",
      },
      {
        plug: "<Plug>(europa-celltype-raw)",
        rhs: ":<C-u>EuropaCellType raw<CR>",
      },
      {
        plug: "<Plug>(europa-start-kernel)",
        rhs: ":<C-u>EuropaStartKernel<CR>",
      },
      {
        plug: "<Plug>(europa-shutdown-kernel)",
        rhs: ":<C-u>EuropaShutdownKernel<CR>",
      },
      {
        plug: "<Plug>(europa-kernel-status)",
        rhs: ":<C-u>EuropaKernelStatus<CR>",
      },
    ];
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const { plug, rhs } of bindings) {
      assertEquals(
        content.includes(plug),
        true,
        `plugin/mappings.vim must define ${plug}`,
      );
      const lineRe = new RegExp(
        `${escapeRe(plug)}\\s+${escapeRe(rhs)}`,
        "m",
      );
      assertEquals(
        lineRe.test(content),
        true,
        `${plug} must be bound to ${rhs} on the same line`,
      );
    }
  });
});
