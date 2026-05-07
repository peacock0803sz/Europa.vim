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
 * All cases are marked it.ignore until the Vim/Neovim subprocess harness is
 * implemented in a follow-up PR. Subprocess interaction will replace the stubs.
 *
 * @spec-id europa.conformance.undo-e2e.round-trip
 * @spec-id europa.conformance.undo-e2e.opt-out
 * @spec-id europa.conformance.undo-e2e.multi-step
 * @spec-id europa.conformance.undo-e2e.multi-window
 * @spec-id europa.conformance.undo-e2e.scratch-edit
 */

import { describe, it } from "@std/testing/bdd";

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
    it.ignore(`${mutation}: undo reverts, redo re-applies (Vim)`, () => {
      // TODO: spawn vim, open hello.ipynb, call mutation, press u, assert
      // getbufline(), press <C-r>, assert again. Requires Vim subprocess harness.
    });

    it.ignore(`${mutation}: undo reverts, redo re-applies (Neovim)`, () => {
      // TODO: same as Vim path but with nvim.
    });
  }
});

// ---------------------------------------------------------------------------
// T020: SC-007 opt-out + FR-019 :earlier no-op + FR-020 <Plug> normal-only
// @spec-id europa.conformance.undo-e2e.opt-out
// ---------------------------------------------------------------------------

describe("conformance: SC-007 opt-out — disable_default_mappings (T020)", () => {
  it.ignore("u is not bound to <Plug>(europa-undo) when opt-out is set (Vim)", () => {
    // TODO: inject g:europa_disable_default_mappings=v:true, open .ipynb,
    // capture :nmap u, assert no <Plug>(europa-undo).
  });

  it.ignore("u is not bound to <Plug>(europa-undo) when opt-out is set (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });

  it.ignore("FR-019: :earlier is a no-op (line buffer has no undo entries) (Vim)", () => {
    // TODO: run :earlier N, assert viewer unchanged.
  });

  it.ignore("FR-019: :earlier is a no-op (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });

  it.ignore("FR-020: <Plug>(europa-undo) exists only in normal mode (Vim)", () => {
    // TODO: :vmap / :imap must NOT show <Plug>(europa-undo); :nmap must show it.
  });

  it.ignore("FR-020: <Plug>(europa-undo) exists only in normal mode (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });
});

// ---------------------------------------------------------------------------
// T027: SC-005 multi-step round-trip + SC-006 kernel-running no-freeze
// @spec-id europa.conformance.undo-e2e.multi-step
// ---------------------------------------------------------------------------

describe("conformance: SC-005 100×undo×redo round-trip (T027)", () => {
  it.ignore("100 mutations → 100 undos → 100 redos: notebook matches at both ends (Vim)", () => {
    // TODO: subprocess harness.
  });

  it.ignore("100 mutations → 100 undos → 100 redos: notebook matches at both ends (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });
});

describe("conformance: SC-006 kernel-running undo no freeze (T027)", () => {
  it.ignore("undo during long-running cell does not freeze viewer (Vim)", () => {
    // TODO: subprocess harness.
  });

  it.ignore("undo during long-running cell does not freeze viewer (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });
});

// ---------------------------------------------------------------------------
// T031: saveCellEdit round-trip + FR-021 scratch native u independence
// @spec-id europa.conformance.undo-e2e.scratch-edit
// ---------------------------------------------------------------------------

describe("conformance: saveCellEdit undo round-trip (T031)", () => {
  it.ignore("editCell → write → undo: source rolls back in viewer and scratch (Vim)", () => {
    // TODO: subprocess harness.
  });

  it.ignore("editCell → write → undo: source rolls back in viewer and scratch (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });

  it.ignore("FR-021: scratch native u does not consume viewer undo stack (Vim)", () => {
    // TODO: subprocess harness.
  });

  it.ignore("FR-021: scratch native u does not consume viewer undo stack (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });
});

// ---------------------------------------------------------------------------
// T043: FR-017 multi-window sync
// @spec-id europa.conformance.undo-e2e.multi-window
// ---------------------------------------------------------------------------

describe("conformance: FR-017 multi-window sync (T043)", () => {
  it.ignore("undo from window A is reflected in window B (Vim)", () => {
    // TODO: spawn vim, :vsplit, mutate from A, undo from A, check both windows.
  });

  it.ignore("undo from window A is reflected in window B (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });

  it.ignore("undo from window B is reflected in window A (Vim)", () => {
    // TODO: subprocess harness.
  });

  it.ignore("undo from window B is reflected in window A (Neovim)", () => {
    // TODO: same as Vim path but with nvim.
  });
});
