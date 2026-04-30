/**
 * BDD specs for loadConfig.
 *
 * @spec-id europa.config.load
 * @spec-id europa.config.default-values
 * @spec-id europa.config.invalid-rejected
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { mockVim } from "../fixtures/mock-host.ts";
import { EuropaConfigError, loadConfig } from "../../denops/europa/config.ts";

describe("loadConfig — basic loading", () => {
  it("returns an EuropaConfig when all g:europa_* vars are valid", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(typeof config, "object");
  });

  it("returns default values when no g:europa_* vars are set", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(config.image_backend, "auto");
    assertEquals(config.max_output_lines, 100);
    assertEquals(config.lazy_padding, 10);
    assertEquals(config.auto_save, false);
  });

  it("respects overridden g:europa_image_backend", async () => {
    const denops = mockVim();
    denops.setEval(`get(g:, 'europa_image_backend', "auto")`, "sixel");
    const config = await loadConfig(denops);
    assertEquals(config.image_backend, "sixel");
  });
});

describe("loadConfig — validation", () => {
  it("throws EuropaConfigError for an invalid image_backend value", async () => {
    const denops = mockVim();
    denops.setEval(
      `get(g:, 'europa_image_backend', "auto")`,
      "unknown_backend",
    );
    await assertRejects(
      () => loadConfig(denops),
      EuropaConfigError,
    );
  });

  it("throws EuropaConfigError for a non-integer max_output_lines", async () => {
    const denops = mockVim();
    denops.setEval("get(g:, 'europa_max_output_lines', 100)", "not-a-number");
    await assertRejects(
      () => loadConfig(denops),
      EuropaConfigError,
    );
  });
});

describe("loadConfig — deprecated g:europa_use_default_mappings", () => {
  /**
   * @spec-id europa.config.deprecated-use-default-mappings
   *
   * When g:europa_use_default_mappings is defined in the session, loadConfig
   * must emit a WarningMsg via :echom so users know the option is ignored.
   */
  it("emits a deprecation warning when g:europa_use_default_mappings is defined", async () => {
    const denops = mockVim();
    // Simulate the variable existing in the session
    denops.setEval(`exists('g:europa_use_default_mappings')`, 1);
    await loadConfig(denops);
    const warnCall = denops.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        c.args[0].includes("use_default_mappings") &&
        c.args[0].includes("deprecated"),
    );
    assertEquals(
      warnCall !== undefined,
      true,
      "Expected a deprecation warning cmd call for g:europa_use_default_mappings",
    );
  });

  it("does not emit a warning when g:europa_use_default_mappings is absent", async () => {
    const denops = mockVim();
    denops.setEval(`exists('g:europa_use_default_mappings')`, 0);
    await loadConfig(denops);
    const warnCall = denops.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        c.args[0].includes("use_default_mappings"),
    );
    assertEquals(warnCall, undefined);
  });
});
