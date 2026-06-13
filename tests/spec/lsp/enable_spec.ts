/**
 * Spec for the LSP mirror enablement gate (Phase 3.9).
 *
 * resolveLspEnabled decides mirror vs 004 scratch from g:europa_lsp_enable:
 * `false` always falls back; `true` and `"auto"` are both python-gated so a
 * non-python notebook never gets a mirror (FR-004 / FR-006 / research §11).
 *
 * @module tests/spec/lsp/enable_spec
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Cell, Notebook } from "../../../schema/notebook.ts";
import { resolveLspEnabled } from "../../../denops/europa/view/viewer.ts";

function codeCell(): Cell {
  return {
    cell_type: "code",
    id: "c1",
    source: "x = 1",
    execution_count: null,
    outputs: [],
    metadata: {},
  };
}

function notebookFor(language: string): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language } },
    cells: [codeCell()],
  };
}

describe("resolveLspEnabled", () => {
  it("false → always off (004 scratch)", () => {
    assertEquals(
      resolveLspEnabled(false, notebookFor("python"), codeCell()),
      false,
    );
  });

  it("'auto' → on for a python notebook", () => {
    assertEquals(
      resolveLspEnabled("auto", notebookFor("python"), codeCell()),
      true,
    );
  });

  it("'auto' → off (fallback) for a non-python notebook", () => {
    assertEquals(
      resolveLspEnabled("auto", notebookFor("r"), codeCell()),
      false,
    );
  });

  it("true → python-gated (on for python, off for non-python)", () => {
    assertEquals(
      resolveLspEnabled(true, notebookFor("python"), codeCell()),
      true,
    );
    assertEquals(
      resolveLspEnabled(true, notebookFor("julia"), codeCell()),
      false,
    );
  });
});
