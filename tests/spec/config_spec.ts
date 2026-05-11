/**
 * BDD specs for loadConfig.
 *
 * @spec-id europa.config.load
 * @spec-id europa.config.default-values
 * @spec-id europa.config.invalid-rejected
 * @spec-id europa.config.ts-highlight-default
 * @spec-id europa.config.ts-highlight-on-off
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

describe("loadConfig — cell_border_chars validation", () => {
  const CHARS_EXPR =
    `get(g:, 'europa_cell_border_chars', ["╭","─","╮","╰","╯"])`;

  it("accepts a valid 5-element array", async () => {
    const denops = mockVim();
    denops.setEval(CHARS_EXPR, ["┌", "═", "┐", "└", "┘"]);
    const config = await loadConfig(denops);
    assertEquals(config.cell_border_chars, ["┌", "═", "┐", "└", "┘"]);
  });

  it("rejects an array of length 4 (minItems: 5)", async () => {
    const denops = mockVim();
    denops.setEval(CHARS_EXPR, ["╭", "─", "╮", "╰"]);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });

  it("rejects an array of length 6 (maxItems: 5)", async () => {
    const denops = mockVim();
    denops.setEval(CHARS_EXPR, ["╭", "─", "╮", "╰", "╯", "x"]);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });

  it("rejects an empty string element (minLength: 1)", async () => {
    const denops = mockVim();
    denops.setEval(CHARS_EXPR, ["", "─", "╮", "╰", "╯"]);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });
});

describe("loadConfig — cell_border_padding validation", () => {
  const PADDING_EXPR = `get(g:, 'europa_cell_border_padding', 4)`;

  it("accepts a non-negative integer", async () => {
    const denops = mockVim();
    denops.setEval(PADDING_EXPR, 8);
    const config = await loadConfig(denops);
    assertEquals(config.cell_border_padding, 8);
  });

  it("accepts 0 (no fill)", async () => {
    const denops = mockVim();
    denops.setEval(PADDING_EXPR, 0);
    const config = await loadConfig(denops);
    assertEquals(config.cell_border_padding, 0);
  });

  it("rejects a negative integer (minimum: 0)", async () => {
    const denops = mockVim();
    denops.setEval(PADDING_EXPR, -1);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });
});

describe("loadConfig — kernelInfoTimeoutMs defaults (europa.config.kernel-info-timeout-defaults)", () => {
  /**
   * @spec-id europa.config.kernel-info-timeout-defaults
   *
   * kernelInfoTimeoutMs must default to 10000, accept values in [1000, 60000],
   * and reject values outside that range.
   */
  const TIMEOUT_EXPR = `get(g:, 'europa_kernel_info_timeout_ms', 10000)`;

  it("defaults to 10000 ms when not set", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(config.kernelInfoTimeoutMs, 10000);
  });

  it("accepts the minimum value 1000", async () => {
    const denops = mockVim();
    denops.setEval(TIMEOUT_EXPR, 1000);
    const config = await loadConfig(denops);
    assertEquals(config.kernelInfoTimeoutMs, 1000);
  });

  it("accepts the maximum value 60000", async () => {
    const denops = mockVim();
    denops.setEval(TIMEOUT_EXPR, 60000);
    const config = await loadConfig(denops);
    assertEquals(config.kernelInfoTimeoutMs, 60000);
  });

  it("rejects a value below minimum (999)", async () => {
    const denops = mockVim();
    denops.setEval(TIMEOUT_EXPR, 999);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });

  it("rejects a value above maximum (60001)", async () => {
    const denops = mockVim();
    denops.setEval(TIMEOUT_EXPR, 60001);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });
});

// ---------------------------------------------------------------------------
// Phase 008: undo/redo config fields
// ---------------------------------------------------------------------------

describe("loadConfig — undo_max_history (europa.config.undo-max-history-default)", () => {
  /**
   * @spec-id europa.config.undo-max-history-default
   */
  const HISTORY_EXPR = `get(g:, 'europa_undo_max_history', 100)`;

  it("defaults to 100 when not set", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(config.undo_max_history, 100);
  });

  it("accepts the minimum value 10", async () => {
    const denops = mockVim();
    denops.setEval(HISTORY_EXPR, 10);
    const config = await loadConfig(denops);
    assertEquals(config.undo_max_history, 10);
  });

  it("accepts the maximum value 1000", async () => {
    const denops = mockVim();
    denops.setEval(HISTORY_EXPR, 1000);
    const config = await loadConfig(denops);
    assertEquals(config.undo_max_history, 1000);
  });
});

describe("loadConfig — undo_max_history out of range (europa.config.undo-max-history-out-of-range)", () => {
  /**
   * @spec-id europa.config.undo-max-history-out-of-range
   */
  const HISTORY_EXPR = `get(g:, 'europa_undo_max_history', 100)`;

  it("rejects value below minimum (9 < 10)", async () => {
    const denops = mockVim();
    denops.setEval(HISTORY_EXPR, 9);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });

  it("rejects value above maximum (1001 > 1000)", async () => {
    const denops = mockVim();
    denops.setEval(HISTORY_EXPR, 1001);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });

  it("rejects non-integer (100.5)", async () => {
    const denops = mockVim();
    denops.setEval(HISTORY_EXPR, 100.5);
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });
});

describe("loadConfig — disable_default_mappings (europa.config.disable-default-mappings-default)", () => {
  /**
   * @spec-id europa.config.disable-default-mappings-default
   */
  it("defaults to false when not set", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(config.disable_default_mappings, false);
  });

  it("accepts true when g:europa_disable_default_mappings = v:true", async () => {
    const denops = mockVim();
    denops.setEval(`get(g:, 'europa_disable_default_mappings', v:false)`, true);
    const config = await loadConfig(denops);
    assertEquals(config.disable_default_mappings, true);
  });
});

describe("loadConfig — ts_highlight (europa.config.ts-highlight-default)", () => {
  const TS_EXPR = `get(g:, 'europa_ts_highlight', "auto")`;

  it("defaults to 'auto' when not set", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    assertEquals(config.ts_highlight, "auto");
  });

  it("accepts 'on'", async () => {
    const denops = mockVim();
    denops.setEval(TS_EXPR, "on");
    const config = await loadConfig(denops);
    assertEquals(config.ts_highlight, "on");
  });

  it("accepts 'off'", async () => {
    const denops = mockVim();
    denops.setEval(TS_EXPR, "off");
    const config = await loadConfig(denops);
    assertEquals(config.ts_highlight, "off");
  });

  it("rejects an invalid value (FR-010)", async () => {
    const denops = mockVim();
    denops.setEval(TS_EXPR, "invalid");
    await assertRejects(() => loadConfig(denops), EuropaConfigError);
  });
});

describe("loadConfig — deprecated g:europa_use_default_mappings", () => {
  /**
   * @spec-id europa.config.deprecated-use-default-mappings
   *
   * When g:europa_use_default_mappings is defined and the per-session flag is
   * not yet set, loadConfig must emit a WarningMsg via :echom. Once
   * g:europa_warned_deprecated_mappings is set, subsequent calls are silent.
   */
  it("emits a deprecation warning on first load when g:europa_use_default_mappings is defined", async () => {
    const denops = mockVim();
    const warnExpr =
      `exists('g:europa_use_default_mappings') && !exists('g:europa_warned_deprecated_mappings')`;
    denops.setEval(warnExpr, 1);
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

  it("does not emit a warning when the per-session flag is already set", async () => {
    const denops = mockVim();
    const warnExpr =
      `exists('g:europa_use_default_mappings') && !exists('g:europa_warned_deprecated_mappings')`;
    denops.setEval(warnExpr, 0);
    await loadConfig(denops);
    const warnCall = denops.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        c.args[0].includes("use_default_mappings"),
    );
    assertEquals(warnCall, undefined);
  });

  it("does not emit a warning when g:europa_use_default_mappings is absent", async () => {
    const denops = mockVim();
    const warnExpr =
      `exists('g:europa_use_default_mappings') && !exists('g:europa_warned_deprecated_mappings')`;
    denops.setEval(warnExpr, 0);
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
