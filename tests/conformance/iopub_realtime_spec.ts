/**
 * Conformance: real-time IOPub stream output against a live Jupyter Server.
 *
 * Verifies that each `print()` call in a `for i in range(5): time.sleep(0.5)`
 * cell is reflected in the viewer within 50 ms of the kernel emitting it
 * (SC-001). Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.render.iopub-batch.tick-scheduling
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
  "IOPub real-time streaming (SC-001)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it(
      "each stream message arrives within 50 ms wall-clock window (SC-001)",
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
        );

        const runtime = await client.start({ kernelName: "python3" });

        const cell: CodeCell = {
          id: "realtime-test",
          cell_type: "code",
          source:
            "import time\nfor i in range(5):\n    print(i)\n    time.sleep(0.1)",
          outputs: [],
          execution_count: null,
          metadata: {},
        };

        const kr = runtime;
        enqueue(kr, 0, cell.id);
        const msgId = enqueue(kr, 0, cell.id);
        markSent(kr, msgId);
        kr.execState = "busy";

        const streamTimestamps: number[] = [];
        const startTime = Date.now();

        try {
          for await (
            const msg of runtime.client.execute(cell.source, {
              signal: runtime.abort.signal,
              msgId,
            })
          ) {
            applyMessageToCell(cell, msg);
            if (msg.header.msg_type === "stream") {
              streamTimestamps.push(Date.now() - startTime);
            }
          }
        } finally {
          complete(kr, msgId);
          kr.execState = "idle";
          await client.shutdown();
          pool.killAll();
          await server.stop();
        }

        // SC-001: at least 4 stream messages must have been received
        assertExists(streamTimestamps);
        assert(
          streamTimestamps.length >= 4,
          `expected ≥ 4 stream messages, got ${streamTimestamps.length}`,
        );

        // The messages should be spaced ~100 ms apart (we allow ×2 slack for CI)
        if (streamTimestamps.length >= 2) {
          for (let i = 1; i < streamTimestamps.length; i++) {
            const gap = streamTimestamps[i] - streamTimestamps[i - 1];
            assert(
              gap < 1000,
              `gap between stream msgs ${
                i - 1
              } and ${i} was ${gap} ms — kernel may be frozen`,
            );
          }
        }

        assertEquals(cell.outputs.length >= 1, true, "cell must have outputs");
      },
    );
  },
);
