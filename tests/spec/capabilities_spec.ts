/**
 * BDD specs for detectCapabilities.
 *
 * @spec-id europa.capabilities.host
 * @spec-id europa.capabilities.auto-resolves-placeholder
 * @spec-id europa.capabilities.explicit-override
 * @spec-id europa.capabilities.tree-sitter-nvim
 * @spec-id europa.capabilities.tree-sitter-vim
 * @spec-id europa.capabilities.tree-sitter-fallback
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { mockNvim, mockVim } from "../fixtures/mock-host.ts";
import { detectCapabilities } from "../../denops/europa/capabilities.ts";

describe("detectCapabilities — host detection", () => {
  it("reports host=vim when denops.meta.host is vim", async () => {
    const denops = mockVim("9.1.1646");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.host, "vim");
  });

  it("reports host=nvim when denops.meta.host is nvim", async () => {
    const denops = mockNvim("0.11.3");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.host, "nvim");
  });

  it("returns hostVersion from meta.version", async () => {
    const denops = mockVim("9.1.1646");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.hostVersion, "9.1.1646");
  });
});

describe("detectCapabilities — image_backend resolution", () => {
  it("resolves auto to placeholder in Phase 2 (invariant FR-023)", async () => {
    const denops = mockVim();
    denops.setEval("g:europa_image_backend", "auto");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "placeholder");
  });

  it("resolves undefined g:europa_image_backend to placeholder", async () => {
    const denops = mockVim();
    // evalValues map returns null by default
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "placeholder");
  });

  it("respects explicit sixel override", async () => {
    const denops = mockVim();
    denops.setEval("g:europa_image_backend", "sixel");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "sixel");
  });

  it("respects explicit placeholder override", async () => {
    const denops = mockVim();
    denops.setEval("g:europa_image_backend", "placeholder");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "placeholder");
  });

  it("respects explicit kitty_placeholder override", async () => {
    const denops = mockVim();
    denops.setEval("g:europa_image_backend", "kitty_placeholder");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "kitty_placeholder");
  });

  it("respects explicit iterm2_osc1337 override", async () => {
    const denops = mockVim();
    denops.setEval("g:europa_image_backend", "iterm2_osc1337");
    const caps = await detectCapabilities(denops);
    assertEquals(caps.image, "iterm2_osc1337");
  });
});

describe("detectCapabilities — tree-sitter detection (T013)", () => {
  it("detects tree-sitter available on Neovim with luaeval returning true", async () => {
    // europa.capabilities.tree-sitter-nvim
    const denops = mockNvim();
    denops.setEval(
      "luaeval('(function() local ok, present = pcall(function() return vim.treesitter ~= nil end); return ok and present end)()')",
      true,
    );
    const caps = await detectCapabilities(denops);
    assertEquals(caps.treeSitter.available, true);
  });

  it("reports tree-sitter unavailable on Vim host regardless of eval", async () => {
    // europa.capabilities.tree-sitter-vim
    const denops = mockVim();
    const caps = await detectCapabilities(denops);
    assertEquals(caps.treeSitter.available, false);
  });

  it("reports tree-sitter unavailable when Neovim luaeval returns null (no tree-sitter)", async () => {
    // europa.capabilities.tree-sitter-fallback
    const denops = mockNvim();
    // evalValues does not contain the luaeval expr → returns null → treated as false
    const caps = await detectCapabilities(denops);
    assertEquals(caps.treeSitter.available, false);
  });
});
