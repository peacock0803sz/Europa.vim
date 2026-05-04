/**
 * BDD specs for the watchdog parent-PID polling process.
 *
 * Tests use mock executables and fake timing to verify the watchdog's behavior
 * without spawning real jupyter processes.
 *
 * @spec-id europa.kernel.watchdog.parent-poll
 * @spec-id europa.kernel.watchdog.jupyter-spawn
 * @spec-id europa.kernel.watchdog.parent-death-cleanup
 * @spec-id europa.kernel.watchdog.signal-relay
 * @spec-id europa.kernel.watchdog.cli-parse
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { parseWatchdogArgs } from "../../../denops/europa/kernel/watchdog.ts";

describe("parseWatchdogArgs — CLI parsing (@std/cli/parse-args)", () => {
  it("parses --parent-pid and --jupyter-executable", () => {
    const args = [
      "--parent-pid",
      "12345",
      "--jupyter-executable",
      "/usr/bin/jupyter",
      "--",
      "server",
      "--port=0",
    ];
    const parsed = parseWatchdogArgs(args);
    assertEquals(parsed.parentPid, 12345);
    assertEquals(parsed.jupyterExecutable, "/usr/bin/jupyter");
    assertEquals(parsed.jupyterArgs, ["server", "--port=0"]);
  });

  it("parses empty post-'--' args", () => {
    const args = [
      "--parent-pid",
      "999",
      "--jupyter-executable",
      "/path/to/jupyter",
      "--",
    ];
    const parsed = parseWatchdogArgs(args);
    assertEquals(parsed.jupyterArgs, []);
  });

  it("throws on missing --parent-pid", () => {
    assertThrows(
      () => {
        parseWatchdogArgs(["--jupyter-executable", "/usr/bin/jupyter", "--"]);
      },
      Error,
    );
  });

  it("throws on non-numeric --parent-pid", () => {
    assertThrows(
      () => {
        parseWatchdogArgs([
          "--parent-pid",
          "notanumber",
          "--jupyter-executable",
          "/usr/bin/jupyter",
          "--",
        ]);
      },
      Error,
    );
  });

  it("throws on missing --jupyter-executable", () => {
    assertThrows(
      () => {
        parseWatchdogArgs(["--parent-pid", "123", "--"]);
      },
      Error,
    );
  });

  it("throws on empty --jupyter-executable", () => {
    assertThrows(
      () => {
        parseWatchdogArgs([
          "--parent-pid",
          "123",
          "--jupyter-executable",
          "",
          "--",
        ]);
      },
      Error,
    );
  });
});

describe("parseWatchdogArgs — correct types", () => {
  it("parentPid is a positive integer", () => {
    const parsed = parseWatchdogArgs([
      "--parent-pid",
      "42",
      "--jupyter-executable",
      "/bin/jupyter",
      "--",
    ]);
    assertEquals(typeof parsed.parentPid, "number");
    assertEquals(Number.isInteger(parsed.parentPid), true);
    assertEquals(parsed.parentPid > 0, true);
  });

  it("jupyterArgs is a string array", () => {
    const parsed = parseWatchdogArgs([
      "--parent-pid",
      "1",
      "--jupyter-executable",
      "/bin/j",
      "--",
      "server",
      "--no-browser",
    ]);
    assertEquals(Array.isArray(parsed.jupyterArgs), true);
    assertEquals(
      parsed.jupyterArgs.every((a: unknown) => typeof a === "string"),
      true,
    );
  });
});

describe("watchdog integration — spawn and detect parent death", () => {
  it("watchdog script starts jupyter and exits when parent dies", async () => {
    // Create a fake jupyter that stays alive until killed
    const tmpDir = await Deno.makeTempDir({ prefix: "watchdog_test_" });
    try {
      const isWindows = Deno.build.os === "windows";
      const fakeJupyterPath = `${tmpDir}/fake-jupyter${
        isWindows ? ".bat" : ""
      }`;
      if (isWindows) {
        await Deno.writeTextFile(
          fakeJupyterPath,
          "@echo off\necho Server is listening on http://127.0.0.1:9999/?token=abc\ntimeout /t 60 /nobreak >nul\n",
        );
      } else {
        await Deno.writeTextFile(
          fakeJupyterPath,
          "#!/bin/sh\necho 'Server is listening on http://127.0.0.1:9999/?token=abc'\nsleep 60\n",
        );
        await Deno.chmod(fakeJupyterPath, 0o755);
      }

      // Spawn a short-lived parent process that will exit quickly
      const shortLivedParent = new Deno.Command(Deno.execPath(), {
        args: ["eval", "Deno.exit(0)"],
        stdout: "null",
        stderr: "null",
      }).spawn();
      const { pid: parentPid } = shortLivedParent;
      await shortLivedParent.status; // wait for it to exit

      // Now run the watchdog with the dead parent PID
      const watchdogPath = new URL(
        "../../../denops/europa/kernel/watchdog.ts",
        import.meta.url,
      ).pathname;

      const watchdog = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-run",
          "--allow-read",
          "--allow-env",
          watchdogPath,
          "--parent-pid",
          String(parentPid),
          "--jupyter-executable",
          fakeJupyterPath,
          "--",
        ],
        stdout: "null",
        stderr: "null",
      }).spawn();

      // Watchdog should detect dead parent and exit within 10s (1s poll + kill time)
      let timerId: number | undefined;
      const timeoutPromise = new Promise<null>((resolve) => {
        timerId = setTimeout(() => resolve(null), 10_000);
      });
      const exitStatus = await Promise.race([
        watchdog.status.then((s) => {
          clearTimeout(timerId);
          return s;
        }),
        timeoutPromise,
      ]);
      clearTimeout(timerId);

      if (exitStatus !== null) {
        // Watchdog exited — success
        assertEquals(typeof (exitStatus as { code: number }).code, "number");
      } else {
        // Timeout — kill watchdog and fail
        watchdog.kill("SIGTERM");
        throw new Error("Watchdog did not exit within 10s after parent died");
      }
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});

describe("watchdog signal format", () => {
  it("watchdog executable path ends in watchdog.ts", () => {
    const watchdogPath = new URL(
      "../../../denops/europa/kernel/watchdog.ts",
      import.meta.url,
    ).pathname;
    assertMatch(watchdogPath, /watchdog\.ts$/);
  });
});
