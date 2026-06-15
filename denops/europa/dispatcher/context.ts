import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { BuildRenderPlanOpts } from "../../../schema/render-plan.ts";
import type { ServerPool } from "../kernel/server-pool.ts";
import type { SessionStore } from "../session/state.ts";
import type { KernelClient } from "../../../contracts/kernel-client.ts";

export type DispatcherContext = {
  denops: Denops;
  sessionStore: SessionStore;
  serverPool: ServerPool;
  /**
   * Override the ZMQ client factory (defaults to createZmqKernelClient). Tests
   * inject an in-memory transport double here so attach specs stay FFI-free.
   */
  createZmqClient?: (
    denops: Denops,
    config: EuropaConfig,
    connectionFile: string,
  ) => KernelClient;
};

/** Wrap a string as a Vimscript single-quoted literal, escaping ' by doubling. */
export function vimSingleQuote(s: string): string {
  return "'" + s.replace(/\r\n?/g, "\n").replace(/\n/g, "\\n").replace(
    /'/g,
    "''",
  ) + "'";
}

/**
 * Emit an error message to Vim's `:messages` without throwing.
 * Uses `echohl ErrorMsg` so the message appears in red.
 */
export async function echomError(
  denops: Denops,
  reason: string,
): Promise<void> {
  await denops.cmd(
    `echohl ErrorMsg | echom ${
      vimSingleQuote(`Europa: ${reason}`)
    } | echohl None`,
  );
}

/**
 * Emit an informational message to Vim's `:messages` without throwing.
 */
export async function echomInfo(
  denops: Denops,
  message: string,
): Promise<void> {
  await denops.cmd(`echom ${vimSingleQuote(`Europa: ${message}`)}`);
}

/**
 * Project `EuropaConfig` render-relevant fields onto `BuildRenderPlanOpts`
 * so `buildRenderPlan` receives the user-configured MIME priority and
 * cell-border styling instead of falling back to builder defaults.
 *
 * @spec-id europa.dispatcher.context.render-plan-opts
 */
export function renderPlanOpts(config: EuropaConfig): BuildRenderPlanOpts {
  return {
    maxOutputLines: config.max_output_lines,
    mimePriority: config.mime_priority,
    cellBorderChars: config.cell_border_chars,
    cellBorderPadding: config.cell_border_padding,
    cellBorderAlign: config.cell_border_align,
  };
}
