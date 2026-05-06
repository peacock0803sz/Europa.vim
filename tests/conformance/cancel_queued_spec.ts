/**
 * Conformance: cancel a queued cell during runAll against a real Jupyter Server.
 *
 * Covers US2 (cancel-mid-runAll): 5 code cells are pre-enqueued, cell 4 is
 * cancelled via cancelQueued while cell 3 is running, cell 4 is skipped, and
 * the remaining cell 5 completes normally.
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.dispatcher.conformance-cancel-queued
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { delay } from "@std/async/delay";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import {
  cancelQueued,
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

describe("conformance: cancel-mid-runAll — queued cell is skipped (US2)", () => {
  it("cancel cell 4 while cell 3 is executing: 4 cells run, 1 cancelled", async () => {
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
      const runtime = await client.start({ kernelName: "python3" });

      // 5 code cells: cell 3 (index 2) sleeps briefly to give time to cancel cell 4.
      const cells = [
        makeCodeCell("r1 = 1"),
        makeCodeCell("r2 = 2"),
        makeCodeCell("import time; time.sleep(0.5); r3 = 3"),
        makeCodeCell("r4 = 4"), // will be cancelled
        makeCodeCell("r5 = 5"),
      ];

      // Phase 1: pre-enqueue all cells.
      const entries = cells.map((cell) => ({
        cell,
        msgId: enqueue(runtime, 1, cell.id),
      }));

      // Phase 2: execute cells sequentially, cancelling cell 4 during cell 3.
      let completed = 0;
      let cancelledSkipped = 0;
      let cancelFired = false;

      for (let i = 0; i < entries.length; i++) {
        const { cell, msgId } = entries[i];

        if (!runtime.pendingRequests.has(msgId)) {
          cancelledSkipped++;
          continue;
        }

        markSent(runtime, msgId);

        if (i === 2 && !cancelFired) {
          // Start cell 3 and cancel cell 4 asynchronously while it runs.
          const cell3Promise = (async () => {
            for await (const msg of client.execute(cell.source, { msgId })) {
              applyMessageToCell(cell, msg);
            }
            complete(runtime, msgId);
            completed++;
          })();

          // Cancel cell 4 (entries[3]) shortly after starting cell 3.
          await delay(50);
          cancelQueued(runtime, entries[3].cell.id);
          cancelFired = true;

          await cell3Promise;
        } else {
          for await (const msg of client.execute(cell.source, { msgId })) {
            applyMessageToCell(cell, msg);
          }
          complete(runtime, msgId);
          completed++;
        }
      }

      // 4 cells should have run (cell 4 was cancelled).
      assertEquals(completed, 4, `Expected 4 completed, got ${completed}`);
      assertEquals(
        cancelledSkipped,
        1,
        `Expected 1 cancelled, got ${cancelledSkipped}`,
      );

      // Cell 4 (index 3) must have no outputs (it was never executed).
      assertEquals(
        cells[3].outputs.length,
        0,
        "Cancelled cell must have no outputs",
      );

      // Cells 1, 2, 3, 5 should have been executed without error.
      assert(
        cells[0].execution_count !== null,
        "Cell 1 must have execution_count",
      );
      assert(
        cells[4].execution_count !== null,
        "Cell 5 must have execution_count",
      );

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });
});
