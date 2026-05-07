import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { BuildRenderPlanOpts } from "../../../schema/render-plan.ts";
import type { ServerPool } from "../kernel/server-pool.ts";
import type { SessionStore } from "../session/state.ts";

export type DispatcherContext = {
  denops: Denops;
  sessionStore: SessionStore;
  serverPool: ServerPool;
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

export function renderPlanOpts(config: EuropaConfig): BuildRenderPlanOpts {
  return {
    maxOutputLines: config.max_output_lines,
    cellBorderChars: config.cell_border_chars,
    cellBorderPadding: config.cell_border_padding,
    cellBorderAlign: config.cell_border_align,
  };
}
