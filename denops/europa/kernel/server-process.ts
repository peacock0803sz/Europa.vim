/**
 * Jupyter Server process spawn and Python environment detection.
 *
 * Implements the 6-priority detection chain from DESIGN.md §6.5 (R8),
 * watchdog-wrapped subprocess spawn, startup-log tail, and 2-stage kill.
 *
 * @module europa-kernel-server-process
 * @category Kernel
 */

import { join } from "@std/path/join";
import { exists } from "@std/fs/exists";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { ServerHandle } from "../../../schema/session.ts";
import { EuropaKernelError } from "./errors.ts";

/**
 * Runtime server handle: the TypeBox ServerHandle schema fields plus an
 * optional `kill` callback. TypeBox cannot express functions, so this
 * extension lives outside the schema.
 */
export type ActiveServerHandle = ServerHandle & {
  /** Tear down the subprocess (idempotent). Only set for local spawns. */
  kill?: () => Promise<void>;
};

/** Partial handle returned by spawnJupyterServer (before pool assigns key/refcount). */
export type ServerSpawnResult = Omit<
  ActiveServerHandle,
  "refcount" | "serverKey"
>;

const isWindows = Deno.build.os === "windows";
const VENV_SUBDIR = isWindows ? "Scripts" : "bin";
const JUPYTER_BIN = isWindows ? "jupyter.exe" : "jupyter";
const PATH_FIND_CMD = isWindows ? "where" : "which";

/** Startup log patterns emitted by jupyter_server >= 2.15 */
const STARTUP_PATTERN =
  /http(?:s?):\/\/[^\s]+:(\d+)(?:\/[^\s]*)?(?:\?token=([^\s]+))?/;

async function waitForHttpReady(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: "HEAD", redirect: "manual" });
      try {
        await r.body?.cancel();
      } catch { /* ignore */ }
      return true;
    } catch {
      await new Promise((res) => setTimeout(res, 50));
    }
  }
  return false;
}

function pickFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function findStartupLine(
  stream: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
): Promise<{ port: number; url: string } | null> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return null;
      }
      if (chunk.done) return null;
      buf += dec.decode(chunk.value);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(STARTUP_PATTERN);
        if (m) {
          const port = parseInt(m[1], 10);
          return { port, url: `http://127.0.0.1:${port}` };
        }
      }
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }
}

/**
 * Resolve the Jupyter executable path using the 6-priority detection chain.
 *
 * Priority order (DESIGN.md §6.5 + R8 Windows):
 *   1. config.jupyter_executable (explicit override)
 *   2. {cwd}/.venv/bin/jupyter (or Scripts\jupyter.exe on Windows)
 *   3. {cwd}/venv/bin/jupyter
 *   4. $VIRTUAL_ENV/bin/jupyter
 *   5. $CONDA_PREFIX/bin/jupyter
 *   6. `which jupyter` / `where jupyter` (PATH)
 *
 * Priorities 2-5 are skipped when config.python_env_detect === 'disabled'.
 *
 * @param cwd - Working directory for relative venv detection
 * @param config - Europa config (jupyter_executable + python_env_detect)
 * @returns Resolved absolute path to the jupyter executable
 * @throws EuropaKernelError(JUPYTER_NOT_FOUND) if no executable found
 * @category Kernel
 * @spec-id europa.kernel.server-process.detect
 */
export async function detectJupyterExecutable(
  cwd: string,
  config: EuropaConfig,
): Promise<string> {
  // Priority 1: explicit override
  if (config.jupyter_executable && config.jupyter_executable.length > 0) {
    return config.jupyter_executable;
  }

  if (config.python_env_detect === "auto") {
    // Priority 2-3: cwd-relative venv directories
    for (const venvDir of [".venv", "venv"]) {
      const candidate = join(cwd, venvDir, VENV_SUBDIR, JUPYTER_BIN);
      if (await exists(candidate, { isFile: true })) return candidate;
    }

    // Priority 4-5: environment variable roots
    for (const envVar of ["VIRTUAL_ENV", "CONDA_PREFIX"]) {
      const root = Deno.env.get(envVar);
      if (root && root.length > 0) {
        const candidate = join(root, VENV_SUBDIR, JUPYTER_BIN);
        if (await exists(candidate, { isFile: true })) return candidate;
      }
    }
  }

  // Priority 6: PATH via which/where
  return await findViaPath();
}

/**
 * Find jupyter via PATH using `which` (POSIX) or `where` (Windows).
 *
 * @throws EuropaKernelError(JUPYTER_NOT_FOUND) if not found
 */
async function findViaPath(): Promise<string> {
  try {
    const cmd = new Deno.Command(PATH_FIND_CMD, {
      args: ["jupyter"],
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await cmd.output();
    if (success) {
      const path = new TextDecoder().decode(stdout).trim().split("\n")[0]
        .trim();
      if (path.length > 0) return path;
    }
  } catch {
    // Command not found or permission error
  }
  throw new EuropaKernelError(
    "JUPYTER_NOT_FOUND",
    `jupyter not found. Searched ${PATH_FIND_CMD}. ` +
      "Install with: pip install 'jupyter-server>=2.15' 'ipykernel>=7.0'",
  );
}

/** Options for spawning a Jupyter Server subprocess. */
export type SpawnOptions = {
  cwd?: string;
  port?: number;
  token: string;
  /** AbortSignal to cancel the spawn wait */
  signal?: AbortSignal;
  /** Startup timeout in ms (default: 30000) */
  timeoutMs?: number;
};

/**
 * Spawn a Jupyter Server as a watchdog-wrapped subprocess.
 *
 * The actual `jupyter server` process is started as a child of a watchdog
 * Deno script (`kernel/watchdog.ts`). The watchdog polls the parent PID
 * (= Deno backend) and kills jupyter if the parent disappears (Q4).
 *
 * The function tails stdout until the "Server is listening on ..." log line
 * appears (SC-002: within 30s), then returns a ServerHandle.
 *
 * @param executable - Path to the jupyter executable
 * @param opts - Spawn options (cwd, token, signal, timeoutMs)
 * @returns ServerHandle with pid, port, token, url, refcount=1, kill function
 * @throws EuropaKernelError(SPAWN_TIMEOUT) if startup log not found within timeoutMs
 * @category Kernel
 * @spec-id europa.kernel.server-process.spawn
 * @spec-id europa.kernel.server-process.startup-log
 */
export async function spawnJupyterServer(
  executable: string,
  opts: SpawnOptions,
): Promise<ServerSpawnResult> {
  // jupyter_server logs --port=0 literally as ":0" instead of the actual
  // OS-assigned port, which would defeat our STARTUP_PATTERN parser. So we
  // pre-bind to grab a free port, then close and pass it explicitly.
  const port = opts.port ?? pickFreePort();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const cwd = opts.cwd ?? Deno.cwd();

  const jupyterArgs = [
    "server",
    `--port=${port}`,
    "--no-browser",
    "--ServerApp.disable_check_xsrf=true",
    `--ServerApp.token=${opts.token}`,
  ];

  // Spawn via watchdog for orphan prevention (Q4)
  const watchdogPath = new URL("./watchdog.ts", import.meta.url).pathname;
  // Anchor config discovery to denops/europa/deno.json so the watchdog can
  // resolve its JSR imports regardless of the user's CWD.
  const watchdogConfig = new URL("../deno.json", import.meta.url).pathname;
  const watchdogArgs = [
    "run",
    "--config",
    watchdogConfig,
    "--allow-run",
    "--allow-read",
    "--allow-env",
    "--allow-net",
    watchdogPath,
    "--parent-pid",
    String(Deno.pid),
    "--jupyter-executable",
    executable,
    "--",
    ...jupyterArgs,
  ];

  const child = new Deno.Command(Deno.execPath(), {
    args: watchdogArgs,
    cwd,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  }).spawn();

  // Tail BOTH stdout and stderr for the startup log. jupyter_server logs
  // its "Server is listening on http://..." banner to stderr by default,
  // so reading only stdout would always time out.
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  opts.signal?.addEventListener("abort", () => ac.abort(), { once: true });

  const result = await new Promise<{ port: number; url: string } | null>(
    (resolve) => {
      let pending = 2;
      let settled = false;
      const settle = (val: { port: number; url: string } | null) => {
        if (settled) return;
        if (val) {
          settled = true;
          ac.abort();
          resolve(val);
          return;
        }
        pending--;
        if (pending === 0 && !settled) {
          settled = true;
          resolve(null);
        }
      };
      findStartupLine(child.stdout, ac.signal).then(settle);
      findStartupLine(child.stderr, ac.signal).then(settle);
    },
  );

  clearTimeout(timeoutId);

  const resolvedPort = result?.port ?? 0;
  const resolvedUrl = result?.url ?? "";

  if (resolvedPort === 0) {
    // Kill the child since we couldn't parse the startup log
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    throw new EuropaKernelError(
      "SPAWN_TIMEOUT",
      `Jupyter server did not start within ${timeoutMs}ms. ` +
        "Ensure jupyter-server >= 2.15 is installed.",
    );
  }

  // jupyter logs the URL banner BEFORE the HTTP listener is actually
  // accepting connections (banner is emitted from _announce_to_logs, the
  // listener starts inside the subsequent IOLoop.start()). Wait briefly
  // for the port to accept HTTP so the caller's first fetch doesn't race.
  const ready = await waitForHttpReady(resolvedUrl, 5000);
  if (!ready) {
    try {
      child.kill("SIGTERM");
    } catch { /* ignore */ }
    throw new EuropaKernelError(
      "SPAWN_TIMEOUT",
      `Jupyter server bound but did not accept HTTP within 5s at ${resolvedUrl}`,
    );
  }

  let killed = false;
  return {
    pid: child.pid,
    port: resolvedPort,
    token: opts.token,
    url: resolvedUrl,
    watchdogPid: undefined, // watchdog PID would require IPC; we use child.pid for now
    kill: async () => {
      if (killed) return;
      killed = true;
      await killChildProcess(child);
    },
  };
}

/**
 * Two-stage subprocess kill: SIGTERM → 5s timeout → SIGKILL.
 *
 * Windows: uses `taskkill /pid {pid} /t /f` for forced kill.
 *
 * @param child - The ChildProcess to kill
 * @spec-id europa.kernel.server-process.kill-2-stage
 */
export async function killChildProcess(
  child: Deno.ChildProcess,
): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    return; // Already dead
  }

  // Wait up to 5s for graceful exit
  const status = await Promise.race([
    child.status,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
  ]);

  if (status === null) {
    // Force kill after timeout
    if (isWindows) {
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
