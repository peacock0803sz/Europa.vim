/**
 * Conformance: interrupt a running cell against a real Jupyter Server.
 *
 * Covers US3: long-running cell interrupted via REST POST /interrupt,
 * resulting in KeyboardInterrupt traceback within 2s (SC-003).
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.kernel.interrupt.conformance-running
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertExists } from "@std/assert";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import type { EuropaConfig } from "../../schema/config.ts";
import type { CodeCell } from "../../schema/notebook.ts";
import {
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";

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

function makeMockDenops() {
  return { eval: (_expr: string): Promise<unknown> => Promise.resolve("") };
}

function attachConfig(url: string, token: string): EuropaConfig {
  return {
    connection_mode: "server",
    jupyter_url: url,
    jupyter_token: token,
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
    kernelInfoTimeoutMs: 10000,
    undo_max_history: 100,
    disable_default_mappings: false,
    ts_highlight: "auto",
    lsp_enable: "auto",
  };
}

function makeCodeCell(source: string): CodeCell {
  return {
    id: crypto.randomUUID(),
    cell_type: "code",
    source,
    outputs: [],
    execution_count: null,
    metadata: {},
  };
}

describe("conformance: interrupt running cell (SC-003)", () => {
  it("interrupt time.sleep(30) yields KeyboardInterrupt traceback within 2s", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer({ timeoutMs: 30_000 });
    try {
      const pool = new ServerPool();
      const config = attachConfig(server.url, server.token);
      const client = new ServerKernelClient(
        makeMockDenops() as never,
        config,
        pool,
      );
      await client.start({ kernelName: "python3" });

      const cell = makeCodeCell("import time; time.sleep(30)");

      // Event-driven busy detection: resolve when the first IOPub status:busy
      // arrives for this execute. Replaces a 500ms blind wait so the test
      // proceeds as soon as the kernel actually starts running.
      let signalBusy: () => void = () => {};
      const busySignal = new Promise<void>((r) => {
        signalBusy = r;
      });

      // Start executing in background.
      const execPromise = (async () => {
        for await (const msg of client.execute("import time; time.sleep(30)")) {
          if (
            msg.header.msg_type === "status" &&
            (msg.content as { execution_state?: string }).execution_state ===
              "busy"
          ) {
            signalBusy();
          }
          applyMessageToCell(cell, msg);
        }
      })();

      // Wait for the kernel to be busy before interrupting.
      await busySignal;

      const t0 = Date.now();
      await client.interrupt();

      // The execute generator should terminate after receiving the error reply.
      await execPromise;
      const elapsed = Date.now() - t0;

      // SC-003: interrupt must produce idle within 2 s.
      assert(
        elapsed < 2_000,
        `interrupt→idle took ${elapsed}ms, expected < 2000ms`,
      );

      // The cell must have a KeyboardInterrupt error output.
      const errorOut = cell.outputs.find((o) => o.output_type === "error");
      assertExists(errorOut, "Expected error output after interrupt");
      assert(
        (errorOut as { ename: string }).ename === "KeyboardInterrupt",
        `Expected KeyboardInterrupt, got ${
          (errorOut as { ename: string }).ename
        }`,
      );

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });
});
