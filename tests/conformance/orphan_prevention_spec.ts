/**
 * Conformance: Orphan prevention via watchdog (Q4).
 *
 * Covers SC-005a: when the parent Deno process is SIGKILL'd, the watchdog
 * (which polls the parent PID every 1 second) must detect the orphan and
 * kill the jupyter subprocess within 15 seconds.
 *
 * This test spawns a real `jupyter server` guarded by the watchdog script, then
 * SIGKILLs a fake-parent process and observes that the jupyter pid disappears.
 *
 * Note: SIGKILL is POSIX-only. On Windows this test is skipped automatically
 * because Deno.kill with SIGKILL is not available. The CI matrix marks Windows
 * jobs as informational for this reason (e2e-workflow.md).
 *
 * @spec-id europa.conformance.orphan-prevention.parent-sigkill
 */

import { describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { delay } from "@std/async/delay";
import { join } from "@std/path/join";
import { ensureJupyter, JupyterMissingError } from "./setup.ts";

let jupyterPresent = true;
try {
  await ensureJupyter();
} catch (e) {
  if (e instanceof JupyterMissingError) {
    jupyterPresent = false;
    console.warn(String(e));
  } else {
    throw e;
  }
}

const isWindows = Deno.build.os === "windows";

/** Return true if the given PID is still alive. */
function isPidAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/** Wait until pid disappears, up to timeoutMs. Returns true if pid is gone. */
async function waitUntilGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await delay(500);
  }
  return false;
}

/**
 * Spawn a minimal "fake parent" process (a long-running `deno eval sleep`)
 * so the watchdog has a real PID to poll. Returns the process and its pid.
 */
async function spawnFakeParent(): Promise<
  { pid: number; proc: Deno.ChildProcess }
> {
  // Spawn a process that sleeps for a long time so we can SIGKILL it.
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["eval", "await new Promise(r => setTimeout(r, 300_000))"],
    stdout: "null",
    stderr: "null",
  });
  const proc = cmd.spawn();
  // Give the process a moment to start so its PID is reliably assigned.
  await delay(100);
  return { pid: proc.pid, proc };
}

describe("conformance: orphan prevention — parent SIGKILL (SC-005a)", () => {
  it("watchdog detects fake-parent SIGKILL and kills jupyter within 15s", async () => {
    if (!jupyterPresent || isWindows) return;

    const jupyterExec = new TextDecoder().decode(
      (await new Deno.Command("which", { args: ["jupyter"], stdout: "piped" })
        .output()).stdout,
    ).trim();

    const token = crypto.randomUUID().replace(/-/g, "");
    // Pick a free port.
    const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const { pid: fakePid, proc: fakeParent } = await spawnFakeParent();

    const watchdogPath = join(
      Deno.cwd(),
      "denops/europa/kernel/watchdog.ts",
    );

    // Spawn the watchdog wrapping jupyter. The watchdog polls fakePid.
    const watchdogCmd = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-run",
        "--allow-read",
        "--allow-env",
        watchdogPath,
        `--parent-pid=${fakePid}`,
        `--jupyter-executable=${jupyterExec}`,
        "--",
        "server",
        `--port=${port}`,
        `--ServerApp.token=${token}`,
        "--no-browser",
        "--ServerApp.open_browser=False",
      ],
      stdout: "null",
      stderr: "piped",
    });
    const watchdogProc = watchdogCmd.spawn();

    // Wait for jupyter to start (look for startup log on watchdog's stderr).
    const STARTUP_RE = /http(?:s?):\/\/[^\s]+:\d+/;
    const reader = watchdogProc.stderr.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const startDeadline = Date.now() + 30_000;
    let jupyterStarted = false;
    while (Date.now() < startDeadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      if (STARTUP_RE.test(buf)) {
        jupyterStarted = true;
        break;
      }
    }
    reader.releaseLock();
    watchdogProc.stderr.cancel().catch(() => {});

    if (!jupyterStarted) {
      // Cleanup even on failure.
      try {
        fakeParent.kill("SIGKILL");
      } catch { /**/ }
      await fakeParent.status;
      try {
        watchdogProc.kill("SIGKILL");
      } catch { /**/ }
      await watchdogProc.status;
      throw new Error(
        "jupyter server did not start within 30s — cannot run orphan test",
      );
    }

    // The watchdog process is alive and polling fakePid.
    const watchdogPid = watchdogProc.pid;
    assert(
      isPidAlive(watchdogPid),
      "watchdog should be alive after jupyter start",
    );

    // Now SIGKILL the fake parent — watchdog should detect this within ~2 polling cycles.
    fakeParent.kill("SIGKILL");
    await fakeParent.status;

    // SC-005a: watchdog must clean up within 15 seconds.
    const gone = await waitUntilGone(watchdogPid, 15_000);

    assert(
      gone,
      `watchdog (pid=${watchdogPid}) still alive 15s after fake-parent SIGKILL`,
    );
  });
});
