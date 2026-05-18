/**
 * Shared setup helpers for conformance tests.
 *
 * Detects the `jupyter` executable, spawns a real `jupyter server` on a random
 * port, and tears it down after each test. Tests skip early if `jupyter` is not
 * in PATH so the conformance suite can run on any machine without a hard fail.
 *
 * @module tests/conformance/setup
 */

/** Thrown by ensureJupyter() when the `jupyter` binary is absent. */
export class JupyterMissingError extends Error {}

/** Minimum info needed to connect to a running jupyter server in tests. */
export interface ConformanceServer {
  url: string;
  token: string;
  port: number;
  /** Resolves when the server process has fully stopped. */
  stop(): Promise<void>;
}

/**
 * Locate `jupyter` in PATH. Throws JupyterMissingError with actionable message
 * if absent (FR-052b early-exit requirement).
 */
export async function ensureJupyter(): Promise<string> {
  const findCmd = Deno.build.os === "windows" ? "where" : "which";
  const result = await new Deno.Command(findCmd, {
    args: ["jupyter"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) {
    throw new JupyterMissingError(
      "[europa] error: 'jupyter' not found in PATH\n" +
        "[europa] Install with: pip install 'jupyter-server>=2.15,<3.0' 'ipykernel>=7.0,<8.0'\n" +
        "[europa] To skip conformance tests, run 'deno task check' instead.",
    );
  }
  return new TextDecoder().decode(result.stdout).trim().split("\n")[0];
}

/**
 * Return a random token string suitable for a test jupyter server.
 */
function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Pick a free TCP port by briefly binding to port 0 and releasing the listener.
 * The TOCTOU window (between close and jupyter bind) is negligible in practice,
 * and the HTTP readiness poll below handles any residual Connection-refused race.
 */
function pickFreePort(): number {
  const l = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (l.addr as Deno.NetAddr).port;
  l.close();
  return port;
}

const TRACE_ENABLED = Deno.env.get("EUROPA_SPAWN_TRACE") === "1";

function traceMark(phase: string, t0: number): void {
  if (!TRACE_ENABLED) return;
  const elapsedMs = (performance.now() - t0).toFixed(1);
  // Fixed format for grep aggregation in CI logs.
  console.error(`[spawn-trace] phase=${phase} elapsed_ms=${elapsedMs}`);
}

/**
 * Spawn a real `jupyter server` on a free port with the given token. Polls
 * the HTTP `/api` endpoint with exponential backoff until the server is ready.
 * Races against `proc.status` so an early process exit (e.g. port collision)
 * is detected without waiting for the full deadline.
 *
 * Note: `--port=0` cannot be used because jupyter logs the configured value (0)
 * rather than the OS-assigned port. We use pickFreePort() + explicit port instead.
 *
 * @throws Error if the server does not become reachable on `/api` within
 *   `timeoutMs` (default 30s), or if the process exits before becoming ready.
 */
export async function spawnConformanceServer(
  opts: { timeoutMs?: number } = {},
): Promise<ConformanceServer> {
  const t0 = performance.now();
  const token = randomToken();
  const port = pickFreePort();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  traceMark("port_picked", t0);

  const proc = new Deno.Command("jupyter", {
    args: [
      "server",
      `--port=${port}`,
      `--ServerApp.token=${token}`,
      "--no-browser",
      "--ServerApp.open_browser=False",
      // Disable extensions that are irrelevant to conformance tests but add
      // ~2s of boot time. jupyter_lsp scans the system for installed LSP
      // servers; jupyterlab/notebook/nbclassic load full UI assets;
      // notebook_shim and terminals are not exercised by these tests.
      "--ServerApp.jpserver_extensions=jupyter_lsp=False",
      "--ServerApp.jpserver_extensions=notebook_shim=False",
      "--ServerApp.jpserver_extensions=jupyterlab=False",
      "--ServerApp.jpserver_extensions=nbclassic=False",
      "--ServerApp.jpserver_extensions=notebook=False",
      "--ServerApp.jpserver_extensions=jupyter_server_terminals=False",
      "--ServerApp.terminals_enabled=False",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  traceMark("proc_spawned", t0);

  const url = `http://127.0.0.1:${port}`;
  const deadline = performance.now() + timeoutMs;

  // procExited resolves if jupyter dies before becoming ready.
  let procExited = false;
  const procStatus = proc.status.then((s: Deno.CommandStatus) => {
    procExited = true;
    return s;
  });

  // Exponential backoff: 10, 20, 40, 80, 160, 200, 200, ...
  let waitMs = 10;
  while (performance.now() < deadline) {
    if (procExited) {
      throw new Error(
        `jupyter server exited before becoming ready (port ${port})`,
      );
    }
    try {
      const resp = await fetch(`${url}/api`, {
        signal: AbortSignal.timeout(500),
      });
      await resp.body?.cancel();
      if (resp.status < 500) {
        traceMark("http_ready", t0);
        return {
          url,
          token,
          port,
          async stop() {
            try {
              proc.kill("SIGTERM");
            } catch { /* already dead */ }
            await procStatus;
          },
        };
      }
    } catch { /* not ready yet, retry */ }
    await new Promise<void>((r) => setTimeout(r, waitMs));
    waitMs = Math.min(waitMs * 2, 200);
  }

  // Readiness deadline reached without /api responding.
  try {
    proc.kill("SIGTERM");
  } catch { /* already dead */ }
  await procStatus;
  throw new Error(`jupyter server did not become ready within ${timeoutMs}ms`);
}
