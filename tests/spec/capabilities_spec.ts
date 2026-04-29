/**
 * BDD specs for detectCapabilities.
 *
 * @spec-id europa.capabilities.host
 * @spec-id europa.capabilities.auto-resolves-placeholder
 * @spec-id europa.capabilities.explicit-override
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
