/**
 * BDD specs for the Europa syntax-highlight layer.
 *
 * Phase 3 (User Story 1) will expand this file with FR-001 / FR-007 /
 * FR-012 / FR-015 / FR-016 / FR-017 / SC-007 / SC-009 cases.
 *
 * @spec-id europa.view.syntax-highlight.vim-noop
 * @spec-id europa.view.syntax-highlight.factory
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { mockNvim, mockVim } from "../../fixtures/mock-host.ts";
import { createSyntaxHighlighter } from "../../../denops/europa/view/syntax-highlight.ts";
import { VimSyntaxHighlighter } from "../../../denops/europa/view/syntax-highlight-vim.ts";
import { NvimSyntaxHighlighter } from "../../../denops/europa/view/syntax-highlight-nvim.ts";

describe("VimSyntaxHighlighter — no-op (europa.view.syntax-highlight.vim-noop)", () => {
  it("init resolves without throwing", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.init(denops);
    assertEquals(denops.calls.length, 0);
  });

  it("attach resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.attach(1, []);
    assertEquals(denops.calls.length, 0);
  });

  it("refresh resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.refresh(1, []);
    assertEquals(denops.calls.length, 0);
  });

  it("detach resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.detach(1);
    assertEquals(denops.calls.length, 0);
  });
});

describe("createSyntaxHighlighter factory (europa.view.syntax-highlight.factory)", () => {
  it("returns VimSyntaxHighlighter for Vim host", () => {
    const denops = mockVim();
    const hl = createSyntaxHighlighter(denops);
    assertEquals(hl instanceof VimSyntaxHighlighter, true);
  });

  it("returns NvimSyntaxHighlighter for Neovim host", () => {
    const denops = mockNvim();
    const hl = createSyntaxHighlighter(denops);
    assertEquals(hl instanceof NvimSyntaxHighlighter, true);
  });

  it("returns the same instance on repeated calls (WeakMap cache)", () => {
    const denops = mockVim();
    const hl1 = createSyntaxHighlighter(denops);
    const hl2 = createSyntaxHighlighter(denops);
    assertEquals(hl1 === hl2, true);
  });
});
