/**
 * Watchdog process for Jupyter Server orphan prevention (Q4).
 *
 * This script is spawned as a wrapper around the actual `jupyter server`
 * subprocess. It polls the parent PID (= the denops backend Deno process)
 * every 1 second, and kills its jupyter child if the parent disappears.
 *
 * CLI invocation:
 *   deno run --allow-run --allow-read denops/europa/kernel/watchdog.ts \
 *     --parent-pid <PARENT_PID> \
 *     --jupyter-executable <PATH> \
 *     -- <jupyter_args...>
 *
 * @module europa-kernel-watchdog
 * @category Kernel
 */

import { parseArgs } from "@std/cli/parse-args";
import { delay } from "@std/async/delay";

/** Parsed watchdog CLI arguments. */
export type WatchdogArgs = {
  parentPid: number;
  jupyterExecutable: string;
  jupyterArgs: string[];
};

/**
 * Parse and validate watchdog CLI arguments using @std/cli/parse-args.
 *
 * @param args - CLI argument array (typically Deno.args)
 * @returns Parsed and validated WatchdogArgs
 * @throws Error if required args are missing or invalid
 * @category Kernel
 * @spec-id europa.kernel.watchdog.cli-parse
 */
export function parseWatchdogArgs(args: string[]): WatchdogArgs {
  const parsed = parseArgs(args, {
    string: ["parent-pid", "jupyter-executable"],
    "--": true,
  });

  const pidStr = parsed["parent-pid"];
  if (!pidStr || pidStr.length === 0) {
    throw new Error("--parent-pid is required");
  }
  const parentPid = parseInt(pidStr, 10);
  if (
    !Number.isInteger(parentPid) || parentPid <= 0 ||
    String(parentPid) !== pidStr
  ) {
    throw new Error(`--parent-pid must be a positive integer, got: ${pidStr}`);
  }

  const jupyterExecutable = parsed["jupyter-executable"];
  if (!jupyterExecutable || jupyterExecutable.length === 0) {
    throw new Error("--jupyter-executable is required and must be non-empty");
  }

  const jupyterArgs = (parsed["--"] ?? []).map(String);

  return { parentPid, jupyterExecutable, jupyterArgs };
}

/**
 * Check whether a process is alive using SIGCONT (R3).
 *
 * SIGCONT is a no-op for running processes on POSIX, and Deno maps it to an
 * existence check on Windows. Throws Deno.errors.NotFound when the process
 * is gone.
 *
 * @param pid - PID to probe
 * @returns true if alive (including permission-denied edge case), false if gone
 */
function isParentAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    // Permission denied or other errors: assume alive (conservative)
    return true;
  }
}

/**
 * Two-stage kill: SIGTERM → 5s timeout → SIGKILL (or Windows taskkill).
 *
 * @param child - Spawned ChildProcess (jupyter subprocess)
 */
async function killChild(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    return; // Already dead
  }

  const result = await Promise.race([
    child.status,
    new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
  ]);

  if (result === null) {
    if (Deno.build.os === "windows") {
      try {
        await new Deno.Command("taskkill", {
          args: ["/pid", String(child.pid), "/t", "/f"],
          stdout: "null",
          stderr: "null",
        }).output();
      } catch {
        // ignore
      }
    } else {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }
  }
}

/**
 * Watchdog main entry point.
 *
 * Spawns jupyter, polls parent PID, and kills jupyter if parent dies.
 * Also handles SIGTERM for clean Europa-initiated shutdown.
 *
 * @param args - CLI arguments (usually Deno.args)
 * @returns Exit code
 * @category Kernel
 * @spec-id europa.kernel.watchdog.parent-poll
 * @spec-id europa.kernel.watchdog.jupyter-spawn
 * @spec-id europa.kernel.watchdog.parent-death-cleanup
 * @spec-id europa.kernel.watchdog.signal-relay
 */
export async function main(args: string[]): Promise<number> {
  let parsed: WatchdogArgs;
  try {
    parsed = parseWatchdogArgs(args);
  } catch (e) {
    console.error(`watchdog: ${(e as Error).message}`);
    return 1;
  }

  const { parentPid, jupyterExecutable, jupyterArgs } = parsed;

  // Spawn jupyter as our child
  const child = new Deno.Command(jupyterExecutable, {
    args: jupyterArgs,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  let aborted = false;
  const abortController = new AbortController();

  // Handle SIGTERM (= Europa-initiated shutdown)
  // Windows only supports SIGINT via Deno.addSignalListener; use SIGTERM on POSIX
  const signalName = Deno.build.os === "windows" ? "SIGINT" : "SIGTERM";
  try {
    Deno.addSignalListener(signalName, () => {
      aborted = true;
      abortController.abort();
    });
  } catch {
    // Signal listeners may fail on some platforms — continue without it
  }

  // Parent-PID polling loop
  while (!aborted) {
    if (!isParentAlive(parentPid)) {
      // Parent died — kill jupyter and exit
      await killChild(child);
      return 0;
    }

    try {
      await delay(1_000, { signal: abortController.signal });
    } catch {
      // AbortError from SIGTERM handler — fall through to cleanup
      break;
    }
  }

  // SIGTERM received — clean shutdown of jupyter
  await killChild(child);
  return 0;
}

// Run as script
if (import.meta.main) {
  const code = await main(Deno.args);
  Deno.exit(code);
}
