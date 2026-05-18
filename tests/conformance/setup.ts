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

// Matches the port in lines like:
//   http://127.0.0.1:PORT/?token=...
//   http://localhost:PORT/?token=...
const STARTUP_RE = /https?:\/\/\S+?:(\d+)\//;

/**
 * Spawn a real `jupyter server` on a free port with the given token. Waits
 * until the server emits its startup URL line on stderr, then polls the HTTP
 * endpoint until it accepts connections. Times out after `timeoutMs` ms.
 *
 * Uses a single AbortController for the read-loop deadline so no timer
 * objects are leaked between iterations (Deno sanitizer safe).
 *
 * Note: `--port=0` cannot be used because jupyter logs the configured value (0)
 * rather than the OS-assigned port. We use pickFreePort() + explicit port instead.
 *
 * @throws Error if the server does not start within `timeoutMs`
 */
const TRACE_ENABLED = Deno.env.get("EUROPA_SPAWN_TRACE") === "1";

function traceMark(phase: string, t0: number): void {
  if (!TRACE_ENABLED) return;
  const elapsedMs = (performance.now() - t0).toFixed(1);
  // Fixed format for grep aggregation in CI logs.
  console.error(`[spawn-trace] phase=${phase} elapsed_ms=${elapsedMs}`);
}

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
    ],
    stdout: "null",
    stderr: "piped",
  }).spawn();
  traceMark("proc_spawned", t0);

  // Read stderr until the startup URL line appears, using a single timeout.
  const reader = proc.stderr.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let started = false;

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), timeoutMs);

  try {
    while (!ac.signal.aborted) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break;
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value);
      if (STARTUP_RE.test(buf)) {
        started = true;
        break;
      }
    }
  } finally {
    clearTimeout(tid);
    reader.releaseLock();
  }

  if (!started) {
    try {
      proc.kill("SIGTERM");
    } catch { /* already dead */ }
    await proc.status;
    throw new Error(`jupyter server did not start within ${timeoutMs}ms`);
  }
  traceMark("stderr_url_seen", t0);

  const url = `http://127.0.0.1:${port}`;

  // Drain remaining stderr so the process does not block on a full pipe.
  proc.stderr.cancel().catch(() => {});

  // jupyter logs the URL slightly before binding the TCP socket.
  // Poll until the server accepts HTTP connections to avoid "Connection refused".
  const readyDeadline = Date.now() + 5_000;
  while (Date.now() < readyDeadline) {
    try {
      const resp = await fetch(`${url}/api`, {
        signal: AbortSignal.timeout(500),
      });
      await resp.body?.cancel();
      if (resp.status < 500) break; // 200 OK or 403 (auth required) = server is up
    } catch { /* not ready yet, retry */ }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  traceMark("http_ready", t0);

  return {
    url,
    token,
    port,
    async stop() {
      try {
        proc.kill("SIGTERM");
      } catch { /* already dead */ }
      await proc.status;
    },
  };
}
