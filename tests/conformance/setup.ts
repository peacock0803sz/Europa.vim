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
 * Uses crypto.randomUUID() for uniqueness without @std/uuid import.
 */
function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Pick a free TCP port by letting the OS assign one and immediately releasing
 * the listener.
 */
function pickFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

const STARTUP_RE = /http(?:s?):\/\/[^\s]+:(\d+)/;

/**
 * Spawn a real `jupyter server` on a free port with the given token. Waits
 * until the server emits its startup URL line on stderr, then returns the
 * connection details. Times out after `timeoutMs` milliseconds.
 *
 * @throws Error if the server does not start within `timeoutMs`
 */
export async function spawnConformanceServer(
  opts: { timeoutMs?: number } = {},
): Promise<ConformanceServer> {
  const token = randomToken();
  const port = pickFreePort();
  const timeoutMs = opts.timeoutMs ?? 30_000;

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

  // Wait for startup log line on stderr.
  const reader = proc.stderr.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  let started = false;

  while (Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), deadline - Date.now())
      ).catch(() => ({ done: true, value: undefined })),
    ]);
    if (done) break;
    buf += dec.decode(value);
    if (STARTUP_RE.test(buf)) {
      started = true;
      break;
    }
  }

  reader.releaseLock();

  if (!started) {
    proc.kill("SIGTERM");
    await proc.status;
    throw new Error(`jupyter server did not start within ${timeoutMs}ms`);
  }

  const url = `http://127.0.0.1:${port}`;

  // Drain remaining stderr in background so the process doesn't block.
  proc.stderr.cancel().catch(() => {});

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
