/**
 * Shared EuropaConfig / ServerKernelClient factory for conformance specs.
 *
 * Seven specs used to carry a byte-identical copy of this config object and an
 * eighth a near-copy (`abort_race_spec.ts` took `wsReconnectMaxRetries` from a
 * parameter and used a 2 s reconnect interval), and every copy set
 * `kernelInfoTimeoutMs: 10000`. Not one of those took effect. The class reads
 * its handshake budget from the 4th constructor argument alone; production
 * bridges the config field into that argument in `createKernelClient`
 * (`denops/europa/kernel/client.ts`), but a spec that constructs the class
 * directly bypasses the bridge. The spec clients that passed no 4th argument
 * either therefore ran on the constructor default of 30 s, which is the same
 * number as the "within 30000ms" in the CI failures — suggestive, but raising
 * the budget since has not made that flake go away. The others passed 30 s,
 * 60 s or 1 ms explicitly. Building clients here makes the effective budget
 * impossible to get wrong.
 *
 * Kept separate from setup.ts so that module stays a jupyter-process helper
 * with no dependency on denops/ or schema/.
 *
 * @module tests/conformance/client
 */

import type { Denops } from "@denops/std";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import type { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import type { KernelRuntime } from "../../contracts/kernel-client.ts";
import type { EuropaConfig } from "../../schema/config.ts";
import type { ConformanceServer } from "./setup.ts";
import { KERNEL_INFO_TIMEOUT_MS } from "./timeouts.ts";

/**
 * Minimal Denops stub: the kernel client only ever calls `eval()`, from
 * `resolveToken` in `denops/europa/kernel/auth.ts`.
 */
export function mockDenops(): Denops {
  return {
    eval: (_expr: string): Promise<unknown> => Promise.resolve(""),
  } as never;
}

/**
 * Per-spec deviations from the conformance config.
 *
 * The fields the factory exists to own are not overridable. `connection_mode`,
 * `jupyter_url` and `jupyter_token` are what bind the client to `server`;
 * `use_subprocess: true` would send `denops/europa/kernel/session-api.ts` off to
 * spawn a second jupyter instead of attaching to that one; and
 * `kernelInfoTimeoutMs` is read from the constructor argument, so setting it
 * here would type-check and then be silently ignored — the exact trap this
 * module was written to close.
 */
export type ConformanceConfigOverrides = Omit<
  Partial<EuropaConfig>,
  | "connection_mode"
  | "jupyter_url"
  | "jupyter_token"
  | "use_subprocess"
  | "kernelInfoTimeoutMs"
>;

/**
 * Build the EuropaConfig every conformance spec uses.
 *
 * @param server jupyter server whose url and token get wired in
 * @param overrides per-spec deviations, e.g. a longer reconnect interval
 */
export function conformanceConfig(
  server: ConformanceServer,
  overrides: ConformanceConfigOverrides = {},
): EuropaConfig {
  return {
    connection_mode: "server",
    jupyter_url: server.url,
    jupyter_token: server.token,
    jupyter_ws_subprotocol: "auto",
    default_kernel: "python3",
    auto_start_kernel: false,
    jupyter_executable: "",
    python_env_detect: "auto",
    image_backend: "auto",
    mime_priority: ["image/png", "text/plain"],
    max_output_lines: 100,
    cell_border_chars: ["╭", "─", "╮", "╰", "╯"],
    cell_border_padding: 4,
    cell_border_align: "left" as const,
    lazy_padding: 10,
    auto_save: false,
    use_subprocess: false,
    wsReconnectMaxRetries: 5,
    wsReconnectInitialIntervalMs: 1000,
    wsReconnectMultiplier: 2.0,
    // Usable as-is: the constant is already capped at the 60 s maximum
    // schema/config.ts allows, so the config object stays schema-valid.
    kernelInfoTimeoutMs: KERNEL_INFO_TIMEOUT_MS,
    undo_max_history: 100,
    disable_default_mappings: false,
    ts_highlight: "auto",
    lsp_enable: "auto",
    ...overrides,
  };
}

/**
 * Construct a ServerKernelClient bound to `server`.
 *
 * `kernelInfoTimeoutMs` always goes through the 4th constructor argument,
 * because that is the only place the class itself reads it from. Production
 * reaches that argument from the config field via `createKernelClient`; these
 * specs construct the class directly and so have to pass it themselves.
 */
export function createConformanceClient(
  server: ConformanceServer,
  pool: ServerPool,
  opts: {
    kernelInfoTimeoutMs?: number;
    config?: ConformanceConfigOverrides;
    denops?: Denops;
  } = {},
): ServerKernelClient {
  return new ServerKernelClient(
    opts.denops ?? mockDenops(),
    conformanceConfig(server, opts.config),
    pool,
    { kernelInfoTimeoutMs: opts.kernelInfoTimeoutMs ?? KERNEL_INFO_TIMEOUT_MS },
  );
}

/**
 * `client.start()` that dumps the jupyter server's stderr when it fails.
 *
 * The handshake is the one operation that has actually been failing in CI, and
 * the server log is the only place that says whether the kernel process even
 * came up. Specs that expect start() to fail call `client.start()` directly.
 */
export async function startConformanceKernel(
  client: ServerKernelClient,
  server: ConformanceServer,
  startOpts: { kernelName?: string; cwd?: string; signal?: AbortSignal } = {},
): Promise<KernelRuntime> {
  try {
    return await client.start({ kernelName: "python3", ...startOpts });
  } catch (e) {
    server.dumpStderr(`client.start() failed: ${e}`);
    throw e;
  }
}

/**
 * `client.restart()` that dumps the jupyter server's stderr when it fails.
 *
 * Restart re-runs the same `kernel_info` handshake as start, so it can fail the
 * same way — but `denops/europa/kernel/restart.ts` rewrites every failure as
 * `EuropaKernelError("RESTART_HANDSHAKE_FAILED")`. Without this the known flake
 * reaches CI under a name that does not match it and with no server log to say
 * whether the restarted kernel process came up at all.
 */
export async function restartConformanceKernel(
  client: ServerKernelClient,
  server: ConformanceServer,
): Promise<void> {
  try {
    await client.restart();
  } catch (e) {
    server.dumpStderr(`client.restart() failed: ${e}`);
    throw e;
  }
}
