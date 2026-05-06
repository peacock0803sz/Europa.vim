/**
 * Conformance: high-volume IOPub stream output against a live Jupyter Server.
 *
 * Verifies that a `for i in range(50000): print(i)` cell:
 *   (a) completes execution without timeout or unhandled error (SC-002 liveness)
 *   (b) produces no drops — all 50000 lines reach cell.outputs via mergeStreams
 *       (SC-002 + SC-006, R03 mergeStreams invariant)
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.render.iopub-batch.no-shed-no-drop
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import {
  complete,
  enqueue,
  markSent,
} from "../../denops/europa/session/pending-requests.ts";
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
  };
}

describe(
  "IOPub high-volume streaming (SC-002)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it(
      "50000-line print loop completes without timeout and all lines reach cell.outputs (SC-002 + SC-006)",
      { ignore: !jupyterPresent },
      async () => {
        const server = await spawnConformanceServer();
        const config = attachConfig(server.url, server.token);
        const pool = new ServerPool();
        const client = new ServerKernelClient(
          {
            eval: (_e: string): Promise<unknown> => Promise.resolve(""),
          } as never,
          config,
          pool,
          // Generous timeout: 50000 prints may take tens of seconds on slow CI.
          { kernelInfoTimeoutMs: 120_000 },
        );

        const runtime = await client.start({ kernelName: "python3" });

        const cell: CodeCell = {
          id: "high-volume-test",
          cell_type: "code",
          source:
            "import sys\nfor i in range(50000):\n    print(i)\nsys.stdout.flush()",
          outputs: [],
          execution_count: null,
          metadata: {},
        };

        const kr = runtime;
        const msgId = enqueue(kr, 0, cell.id);
        markSent(kr, msgId);
        kr.execState = "busy";

        let executeError: unknown = undefined;

        try {
          for await (
            const msg of runtime.client.execute(cell.source, {
              signal: runtime.abort.signal,
              msgId,
            })
          ) {
            // Mirrors what main.ts does: update cell.outputs before enqueue.
            // mergeStreams (R03) merges consecutive same-name stream outputs.
            applyMessageToCell(cell, msg);
          }
        } catch (e) {
          executeError = e;
        } finally {
          complete(kr, msgId);
          kr.execState = "idle";
          await client.shutdown();
          await pool.killAll();
          await server.stop();
        }

        // (a) Execute must complete without error (SC-002 liveness)
        assertEquals(
          executeError,
          undefined,
          `execute must complete without error; got: ${executeError}`,
        );

        // (b) All 50000 lines must reach cell.outputs — no shed, no drop.
        // After mergeStreams (R03), all stdout is merged into a single stream output.
        assert(
          cell.outputs.length >= 1,
          "cell must have at least one output after 50000 prints",
        );

        const streamOutput = cell.outputs.find(
          (o) =>
            (o as { output_type: string }).output_type === "stream" &&
            (o as { name: string }).name === "stdout",
        ) as { text: string } | undefined;

        assertExists(
          streamOutput,
          "cell must have a stdout stream output after 50000 prints",
        );

        // Count lines by splitting on newline. "0\n1\n...49999\n".split("\n")
        // produces 50001 entries (last is empty string after trailing newline).
        const lineCount =
          streamOutput.text.split("\n").filter((l) => l.length > 0).length;

        assertEquals(
          lineCount,
          50_000,
          `mergeStreams must preserve all 50000 lines; got ${lineCount}`,
        );
      },
    );
  },
);
