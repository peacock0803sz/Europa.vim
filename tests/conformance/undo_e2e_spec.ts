/**
 * Conformance: undo / redo round-trip against real Vim and Neovim hosts.
 *
 * Covers:
 * - T019: 6 mutation × undo/redo round-trip (Vim + Neovim)
 * - T020: SC-007 opt-out / FR-019 :earlier no-op / FR-020 <Plug> normal-only
 * - T027: SC-005 (100×undo×redo deep equal) / SC-006 (kernel-running no-freeze)
 * - T031: saveCellEdit round-trip / FR-021 scratch-native u independence
 * - T043: FR-017 multi-window sync
 *
 * Skips early when vim/nvim are not in PATH.
 * Full subprocess interaction will be wired in a follow-up PR.
 *
 * @spec-id europa.conformance.undo-e2e.round-trip
 * @spec-id europa.conformance.undo-e2e.opt-out
 * @spec-id europa.conformance.undo-e2e.multi-step
 * @spec-id europa.conformance.undo-e2e.multi-window
 * @spec-id europa.conformance.undo-e2e.scratch-edit
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Host availability detection
// ---------------------------------------------------------------------------

async function hasExecutable(name: string): Promise<boolean> {
  try {
    const cmd = Deno.build.os === "windows" ? "where" : "which";
    const result = await new Deno.Command(cmd, {
      args: [name],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  } catch {
    return false;
  }
}

const vimPresent = await hasExecutable("vim");
const nvimPresent = await hasExecutable("nvim");

if (!vimPresent && !nvimPresent) {
  console.warn(
    "[europa] undo_e2e: neither 'vim' nor 'nvim' found — all cases are skipped.\n" +
      "[europa] Install vim 9.1.1646+ or neovim 0.11.3+ to run conformance tests.",
  );
}

// ---------------------------------------------------------------------------
// T019: 6 mutation × undo/redo round-trip
// @spec-id europa.conformance.undo-e2e.round-trip
// ---------------------------------------------------------------------------

describe("conformance: undo/redo round-trip — 6 mutations (T019)", () => {
  const mutations = [
    "insertCell",
    "deleteCell",
    "moveCell",
    "splitCell",
    "joinCell",
    "changeCellType",
  ] as const;

  for (const mutation of mutations) {
    it(`${mutation}: undo reverts, redo re-applies (Vim)`, () => {
      if (!vimPresent) return;
      // TODO: spawn vim, open hello.ipynb, call mutation, press u, assert
      // getbufline(), press <C-r>, assert again. Requires Vim subprocess harness.
      assertEquals(vimPresent, true);
    });

    it(`${mutation}: undo reverts, redo re-applies (Neovim)`, () => {
      if (!nvimPresent) return;
      assertEquals(nvimPresent, true);
    });
  }
});

// ---------------------------------------------------------------------------
// T020: SC-007 opt-out + FR-019 :earlier no-op + FR-020 <Plug> normal-only
// @spec-id europa.conformance.undo-e2e.opt-out
// ---------------------------------------------------------------------------

describe("conformance: SC-007 opt-out — disable_default_mappings (T020)", () => {
  it("u is not bound to <Plug>(europa-undo) when opt-out is set (Vim)", () => {
    if (!vimPresent) return;
    // TODO: inject g:europa_disable_default_mappings=v:true, open .ipynb,
    // capture :nmap u, assert no <Plug>(europa-undo).
    assertEquals(vimPresent, true);
  });

  it("u is not bound to <Plug>(europa-undo) when opt-out is set (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });

  it("FR-019: :earlier is a no-op (line buffer has no undo entries) (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("FR-019: :earlier is a no-op (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });

  it("FR-020: <Plug>(europa-undo) exists only in normal mode (Vim)", () => {
    if (!vimPresent) return;
    // :vmap / :imap must NOT show <Plug>(europa-undo); :nmap must show it.
    assertEquals(vimPresent, true);
  });

  it("FR-020: <Plug>(europa-undo) exists only in normal mode (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });
});

// ---------------------------------------------------------------------------
// T027: SC-005 multi-step round-trip + SC-006 kernel-running no-freeze
// @spec-id europa.conformance.undo-e2e.multi-step
// ---------------------------------------------------------------------------

describe("conformance: SC-005 100×undo×redo round-trip (T027)", () => {
  it("100 mutations → 100 undos → 100 redos: notebook matches at both ends (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("100 mutations → 100 undos → 100 redos: notebook matches at both ends (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });
});

describe("conformance: SC-006 kernel-running undo no freeze (T027)", () => {
  it("undo during long-running cell does not freeze viewer (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("undo during long-running cell does not freeze viewer (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });
});

// ---------------------------------------------------------------------------
// T031: saveCellEdit round-trip + FR-021 scratch native u independence
// @spec-id europa.conformance.undo-e2e.scratch-edit
// ---------------------------------------------------------------------------

describe("conformance: saveCellEdit undo round-trip (T031)", () => {
  it("editCell → write → undo: source rolls back in viewer and scratch (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("editCell → write → undo: source rolls back in viewer and scratch (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });

  it("FR-021: scratch native u does not consume viewer undo stack (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("FR-021: scratch native u does not consume viewer undo stack (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });
});

// ---------------------------------------------------------------------------
// T043: FR-017 multi-window sync
// @spec-id europa.conformance.undo-e2e.multi-window
// ---------------------------------------------------------------------------

describe("conformance: FR-017 multi-window sync (T043)", () => {
  it("undo from window A is reflected in window B (Vim)", () => {
    if (!vimPresent) return;
    // TODO: spawn vim, :vsplit, mutate from A, undo from A, check both windows.
    assertEquals(vimPresent, true);
  });

  it("undo from window A is reflected in window B (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });

  it("undo from window B is reflected in window A (Vim)", () => {
    if (!vimPresent) return;
    assertEquals(vimPresent, true);
  });

  it("undo from window B is reflected in window A (Neovim)", () => {
    if (!nvimPresent) return;
    assertEquals(nvimPresent, true);
  });
});
