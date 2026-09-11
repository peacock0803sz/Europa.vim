/**
 * Shared setup helpers for conformance tests.
 *
 * Detects the `jupyter` executable, spawns a real `jupyter server` on a random
 * port, and tears it down after each test. Tests skip early if `jupyter` is not
 * in PATH so the conformance suite can run on any machine without a hard fail.
 *
 * @module tests/conformance/setup
 */

import {
  EXACT_PORT_RETRY_EARLY_EXIT_MS,
  SERVER_READY_TIMEOUT_MS,
} from "./timeouts.ts";

/** Thrown by ensureJupyter() when the `jupyter` binary is absent. */
export class JupyterMissingError extends Error {}

/** Minimum info needed to connect to a running jupyter server in tests. */
export interface ConformanceServer {
  url: string;
  token: string;
  port: number;
  /** Resolves when the server process has fully stopped. Idempotent. */
  stop(): Promise<void>;
  /** Last {@link STDERR_TAIL_LINES} lines of the server's stderr, oldest first. */
  stderrTail(): string;
  /**
   * Print the stderr tail to the test log, tagged with `reason` and numbered so
   * several dumps from one server stay attributable. A dump whose body is
   * byte-identical to the previous one is skipped, which suppresses the `stop()`
   * echo of a failure dump without silencing the second and later failures on a
   * shared `beforeAll` server.
   */
  dumpStderr(reason: string): void;
}

/**
 * Delete all kernel sessions on the given server.
 *
 * Used as an `afterEach` invariant in shared-server describes: some tests
 * (notably the abort-race and kernel_info-failure paths in
 * `denops/europa/kernel/server-client.ts`) release the local `ServerPool` but
 * do not issue `DELETE /api/sessions/{id}` on the failure path, so a session
 * record can linger on the server. Sharing a server across tests would let
 * those orphans accumulate; this helper sweeps them between tests so each
 * shared-server test sees an empty session list.
 *
 * A sweep that cannot do its job reports to the test log and returns. It runs
 * in `afterEach`, where throwing would replace the failure the test was about
 * to report with this one.
 */
export async function clearAllSessions(
  server: ConformanceServer,
): Promise<void> {
  const headers = { Authorization: `token ${server.token}` };
  const resp = await fetch(`${server.url}/api/sessions`, { headers });
  if (!resp.ok) {
    // Returning quietly here used to make a 403 or a 5xx look like "no sessions
    // to clean up", while every kernel the tests started stayed alive on the
    // shared server — the CPU starvation DENO_JOBS was lowered to avoid.
    const body = (await resp.text()).trim().slice(0, 200);
    console.error(
      `[europa.conformance] session sweep failed: GET /api/sessions -> ` +
        `${resp.status} ${resp.statusText}${body === "" ? "" : ` ${body}`}`,
    );
    return;
  }
  const sessions = (await resp.json()) as Array<{ id: string }>;
  const survivors = await Promise.all(
    sessions.map(async (s) => {
      const r = await fetch(`${server.url}/api/sessions/${s.id}`, {
        method: "DELETE",
        headers,
      });
      await r.body?.cancel();
      return r.ok ? "" : `${s.id} (${r.status})`;
    }),
  );
  const failed = survivors.filter((s) => s !== "");
  if (failed.length > 0) {
    console.error(
      `[europa.conformance] session sweep could not delete ${failed.length} of ` +
        `${sessions.length} sessions: ${failed.join(", ")}`,
    );
  }
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
 * Parallel test execution amplifies the TOCTOU window in pickFreePort() (the
 * port is released before jupyter binds it). If jupyter exits early — which
 * with the disabled-extensions setup almost always indicates EADDRINUSE — we
 * retry up to MAX_PORT_RETRIES times with a fresh port before giving up.
 *
 * Each attempt gets its own full `timeoutMs` budget, and the server's stderr
 * is captured so a failure can say what jupyter actually complained about.
 *
 * @throws Error if the server does not become reachable on `/api` within
 *   `timeoutMs` (default {@link SERVER_READY_TIMEOUT_MS}), or if every retry's
 *   process exits before becoming ready.
 */
const MAX_PORT_RETRIES = 3;

/**
 * Trailing stderr lines retained per server. A healthy run writes a few dozen;
 * a kernel that keeps restarting writes thousands and only the end matters.
 */
const STDERR_TAIL_LINES = 200;

/** When set, dump the jupyter stderr on `stop()` too, not only on failure. */
const ALWAYS_LOG_JUPYTER = (Deno.env.get("EUROPA_JUPYTER_LOG") ?? "") !== "";

interface StderrCapture {
  /**
   * Buffered stderr, with a `<stderr capture aborted: ...>` marker appended if
   * the drain loop died before `close()` and the buffer is therefore short.
   */
  tail(): string;
  dump(reason: string): void;
  /** Stop draining and release the pipe. Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * Drain a child's stderr into a bounded tail buffer.
 *
 * The draining has to start immediately: an unread pipe fills up and blocks
 * the child, and a blocked jupyter server is exactly the hang this capture
 * exists to diagnose.
 */
function captureStderr(stream: ReadableStream<Uint8Array>): StderrCapture {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const lines: string[] = [];
  let partial = "";
  let lastDump: string | undefined;
  let dumpCount = 0;
  let closed = false;
  let captureError: unknown;

  const drain = (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        partial += dec.decode(chunk.value, { stream: true });
        const parts = partial.split("\n");
        partial = parts.pop() ?? "";
        for (const line of parts) {
          lines.push(line);
          if (lines.length > STDERR_TAIL_LINES) lines.shift();
        }
      }
    } catch (e) {
      // A read that fails before close() means the pipe broke under us and the
      // buffer stops here, several lines short of whatever jupyter went on to
      // say. Remember it: an unexplained "<empty>" reads as "jupyter never
      // started", which is the wrong thing to go looking for.
      if (!closed) captureError = e;
    }
  })();

  const tail = (): string => {
    const body = (partial === "" ? lines : [...lines, partial]).join("\n");
    if (captureError === undefined) return body;
    const marker = `<stderr capture aborted: ${captureError}>`;
    return body === "" ? marker : `${body}\n${marker}`;
  };

  return {
    tail,
    dump(reason: string): void {
      // A beforeAll server outlives many tests, so dumping only once per server
      // would leave every failure after the first with no log at all. Dedupe on
      // the body instead: the repeat worth suppressing is a `stop()` echo of a
      // dump nothing has been appended to since.
      const body = tail();
      if (body === lastDump) return;
      lastDump = body;
      dumpCount++;
      console.error(
        `[europa.conformance] jupyter stderr #${dumpCount} (${reason}):`,
      );
      console.error(body === "" ? "  <empty>" : body);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // ipykernel children inherit the write end, so the pipe may never reach
      // EOF on its own. Cancel instead of waiting: a pending read() settles as
      // done, which lets the drain loop finish.
      try {
        await reader.cancel();
      } catch { /* already closed */ }
      await drain;
      try {
        reader.releaseLock();
      } catch { /* already released */ }
    },
  };
}

export async function spawnConformanceServer(
  opts: { timeoutMs?: number } = {},
): Promise<ConformanceServer> {
  const t0 = performance.now();
  const token = randomToken();
  const timeoutMs = opts.timeoutMs ?? SERVER_READY_TIMEOUT_MS;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
    const port = pickFreePort();
    traceMark(`port_picked_attempt_${attempt}`, t0);

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
      // jupyter_server writes its whole log to stderr; stdout stays discarded.
      stderr: "piped",
    }).spawn();
    const stderr = captureStderr(proc.stderr);
    traceMark(`proc_spawned_attempt_${attempt}`, t0);

    const url = `http://127.0.0.1:${port}`;

    // Each attempt gets its own budget. Sharing one deadline across retries let
    // a slow first attempt starve the later ones, which then reported a bogus
    // "did not become ready" instead of the port collision that really happened.
    const attemptStart = performance.now();
    const deadline = attemptStart + timeoutMs;

    // procExited resolves if jupyter dies before becoming ready.
    let procExited = false;
    const procStatus = proc.status.then((s: Deno.CommandStatus) => {
      procExited = true;
      return s;
    });

    // Faster backoff than pre-optimization (10/200ms): readiness is bound by
    // HTTP response latency (~10-50ms), so smaller steps catch the transition
    // sooner. Order: 5, 10, 20, 40, 80, 100, 100, ...
    let waitMs = 5;
    let ready = false;
    while (performance.now() < deadline) {
      if (procExited) break;
      try {
        const resp = await fetch(`${url}/api`, {
          signal: AbortSignal.timeout(500),
        });
        await resp.body?.cancel();
        if (resp.status < 500) {
          ready = true;
          break;
        }
      } catch { /* not ready yet, retry */ }
      await new Promise<void>((r) => setTimeout(r, waitMs));
      waitMs = Math.min(waitMs * 2, 100);
    }

    if (ready) {
      traceMark("http_ready", t0);
      let stopped = false;
      return {
        url,
        token,
        port,
        stderrTail: () => stderr.tail(),
        dumpStderr: (reason: string) => stderr.dump(reason),
        async stop() {
          // abort_race_spec stops the same server from a describe teardown and
          // from a finally block, and the stderr reader cannot be cancelled
          // twice, so this has to be idempotent.
          if (stopped) return;
          stopped = true;
          try {
            proc.kill("SIGTERM");
          } catch { /* already dead */ }
          await procStatus;
          if (ALWAYS_LOG_JUPYTER) stderr.dump("EUROPA_JUPYTER_LOG");
          await stderr.close();
        },
      };
    }

    // Either procExited (likely EADDRINUSE) or deadline reached.
    try {
      proc.kill("SIGTERM");
    } catch { /* already dead */ }
    await procStatus;

    const attemptMs = Math.round(performance.now() - attemptStart);

    // Every dump below runs before close(): close() cancels the reader, which
    // settles the pending read as done and drops whatever is still sitting in
    // the pipe — precisely the bytes a dying jupyter wrote on its way out.
    if (procExited && attemptMs < EXACT_PORT_RETRY_EARLY_EXIT_MS) {
      // A port collision kills jupyter within a second or two, so respawning
      // on a fresh port is worth it. Each attempt has its own capture, so it
      // has to dump its own log here — otherwise the retries that led to the
      // final failure leave no trace of why they were classified as collisions.
      stderr.dump(
        `attempt ${attempt} exited after ${attemptMs}ms on port ${port}`,
      );
      await stderr.close();
      // Chain the attempts so the thrown error carries all of them.
      lastError = new Error(
        `jupyter server exited after ${attemptMs}ms before becoming ready ` +
          `(port ${port}, attempt ${attempt})`,
        { cause: lastError },
      );
      continue;
    }

    if (procExited) {
      // Stayed up a long while and then died: not a collision, so a retry
      // would only multiply the wall-clock cost.
      stderr.dump(`jupyter exited after ${attemptMs}ms without answering /api`);
      await stderr.close();
      throw new Error(
        `jupyter server exited after ${attemptMs}ms without ever answering ` +
          `/api (port ${port}, attempt ${attempt})`,
      );
    }

    stderr.dump(`jupyter did not become ready within ${timeoutMs}ms`);
    await stderr.close();
    throw new Error(
      `jupyter server did not become ready within ${timeoutMs}ms`,
    );
  }

  // Every attempt dumped its own log above, so there is nothing left to print
  // here. The message says what was observed — an early exit on every attempt —
  // rather than asserting the port collision the code only ever guessed at.
  throw lastError ?? new Error(
    `jupyter server exited early on all ${MAX_PORT_RETRIES} attempts`,
  );
}
