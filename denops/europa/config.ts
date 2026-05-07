/**
 * Europa configuration loader.
 *
 * Reads all `g:europa_*` variables from the host and validates them against
 * `EuropaConfigSchema` via TypeBox `Value.Check`. Throws `EuropaConfigError`
 * on any validation failure (FR-039, FR-040).
 *
 * @module config
 */

import type { Denops } from "@denops/std";
import { Value } from "@sinclair/typebox/value";
import { type EuropaConfig, EuropaConfigSchema } from "../../schema/config.ts";

/** Thrown when `g:europa_*` variable values fail schema validation. */
export class EuropaConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly received: unknown,
  ) {
    super(
      `EuropaConfigError at ${path}: ${message} (got ${
        JSON.stringify(received)
      })`,
    );
    this.name = "EuropaConfigError";
  }
}

/**
 * Option definitions: maps config key → Vim global variable name → default value.
 */
const OPTIONS: Array<{ key: keyof EuropaConfig; gvar: string; def: unknown }> =
  [
    { key: "connection_mode", gvar: "connection_mode", def: "auto" },
    {
      key: "jupyter_url",
      gvar: "jupyter_url",
      def: "http://localhost:8888",
    },
    { key: "jupyter_token", gvar: "jupyter_token", def: "" },
    {
      key: "jupyter_ws_subprotocol",
      gvar: "jupyter_ws_subprotocol",
      def: "auto",
    },
    { key: "default_kernel", gvar: "default_kernel", def: "python3" },
    { key: "auto_start_kernel", gvar: "auto_start_kernel", def: false },
    { key: "jupyter_executable", gvar: "jupyter_executable", def: "" },
    { key: "python_env_detect", gvar: "python_env_detect", def: "auto" },
    { key: "image_backend", gvar: "image_backend", def: "auto" },
    {
      key: "mime_priority",
      gvar: "mime_priority",
      def: ["image/png", "image/jpeg", "text/html", "text/plain"],
    },
    { key: "max_output_lines", gvar: "max_output_lines", def: 100 },
    {
      key: "cell_border_chars",
      gvar: "cell_border_chars",
      def: ["╭", "─", "╮", "╰", "╯"],
    },
    { key: "cell_border_padding", gvar: "cell_border_padding", def: 4 },
    { key: "cell_border_align", gvar: "cell_border_align", def: "left" },
    { key: "lazy_padding", gvar: "lazy_padding", def: 10 },
    { key: "auto_save", gvar: "auto_save", def: false },
    { key: "use_subprocess", gvar: "use_subprocess", def: true },
    {
      key: "wsReconnectMaxRetries",
      gvar: "ws_reconnect_max_retries",
      def: 5,
    },
    {
      key: "wsReconnectInitialIntervalMs",
      gvar: "ws_reconnect_initial_interval_ms",
      def: 1000,
    },
    {
      key: "wsReconnectMultiplier",
      gvar: "ws_reconnect_multiplier",
      def: 2.0,
    },
    // Phase 3.3: kernel_info handshake timeout (R04)
    // @spec-id europa.config.kernel-info-timeout-defaults
    {
      key: "kernelInfoTimeoutMs",
      gvar: "kernel_info_timeout_ms",
      def: 10000,
    },
    // Phase 008: undo/redo stack cap (FR-009 / FR-022)
    // @spec-id europa.config.undo-max-history-default
    // @spec-id europa.config.undo-max-history-out-of-range
    {
      key: "undo_max_history",
      gvar: "undo_max_history",
      def: 100,
    },
    // Phase 008: opt-out for ft=europa default u / <C-r> override (FR-004)
    // @spec-id europa.config.disable-default-mappings-default
    {
      key: "disable_default_mappings",
      gvar: "disable_default_mappings",
      def: false,
    },
  ];

/**
 * Load and validate Europa configuration from the current Vim/Neovim session.
 *
 * @param denops - Denops instance for reading global variables.
 * @returns Validated `EuropaConfig` record.
 * @throws {EuropaConfigError} When any option fails schema validation.
 * @spec-id europa.config.load
 * @spec-id europa.config.default-values
 * @spec-id europa.config.invalid-rejected
 * @spec-id europa.config.deprecated-use-default-mappings
 * @spec-id europa.contract.config-alignment
 */
function vimLiteral(value: unknown): string {
  if (value === true) return "v:true";
  if (value === false) return "v:false";
  return JSON.stringify(value);
}

export async function loadConfig(denops: Denops): Promise<EuropaConfig> {
  const raw: Record<string, unknown> = {};

  for (const opt of OPTIONS) {
    const expr = `get(g:, 'europa_${opt.gvar}', ${vimLiteral(opt.def)})`;
    try {
      raw[opt.key] = await denops.eval(expr);
    } catch {
      raw[opt.key] = opt.def;
    }
  }

  if (!Value.Check(EuropaConfigSchema, raw)) {
    const errors = [...Value.Errors(EuropaConfigSchema, raw)];
    const first = errors[0];
    throw new EuropaConfigError(
      first?.message ?? "unknown",
      first?.path ?? "/",
      first?.value,
    );
  }

  // Warn if the user still has the removed option in their vimrc.
  const shouldWarn = await denops.eval(
    `exists('g:europa_use_default_mappings') && !exists('g:europa_warned_deprecated_mappings')`,
  );
  if (shouldWarn) {
    await denops.cmd("let g:europa_warned_deprecated_mappings = 1");
    await denops.cmd(
      "echohl WarningMsg | echom 'g:europa_use_default_mappings is deprecated and ignored. Use <Plug>(europa-*) directly.' | echohl None",
    );
  }

  return raw as EuropaConfig;
}
