/**
 * Conformance: high-volume IOPub stream output against a live Jupyter Server.
 *
 * Verifies that a `for i in range(10000): print(i)` cell:
 *   (a) completes execution without timeout or unhandled error (SC-002 liveness)
 *   (b) produces no drops — all 10000 lines reach cell.outputs via mergeStreams
 *       (SC-002 + SC-006, R03 mergeStreams invariant)
 *
 * The 10k volume comfortably exceeds Jupyter's IOPub buffer thresholds while
 * keeping macOS/Windows CI runners under the 5-minute conformance budget.
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.render.iopub-batch.no-shed-no-drop
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import {
  complete,
  enqueue,
  markSent,
} from "../../denops/europa/session/pending-requests.ts";
import type { CodeCell } from "../../schema/notebook.ts";
import {
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";
import { createConformanceClient, startConformanceKernel } from "./client.ts";

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

describe(
  "IOPub high-volume streaming (SC-002)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it(
      "10000-line print loop completes without timeout and all lines reach cell.outputs (SC-002 + SC-006)",
      { ignore: !jupyterPresent },
      async () => {
        const server = await spawnConformanceServer();
        const pool = new ServerPool();
        const client = createConformanceClient(server, pool);

        const runtime = await startConformanceKernel(client, server);

        const cell: CodeCell = {
          id: "high-volume-test",
          cell_type: "code",
          source:
            "import sys\nfor i in range(10000):\n    print(i)\nsys.stdout.flush()",
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

        // (b) All 10000 lines must reach cell.outputs — no shed, no drop.
        // After mergeStreams (R03), all stdout is merged into a single stream output.
        assert(
          cell.outputs.length >= 1,
          "cell must have at least one output after 10000 prints",
        );

        const streamOutput = cell.outputs.find(
          (o) =>
            (o as { output_type: string }).output_type === "stream" &&
            (o as { name: string }).name === "stdout",
        ) as { text: string } | undefined;

        assertExists(
          streamOutput,
          "cell must have a stdout stream output after 10000 prints",
        );

        // Count lines by splitting on newline. "0\n1\n...9999\n".split("\n")
        // produces 10001 entries (last is empty string after trailing newline).
        const lineCount =
          streamOutput.text.split("\n").filter((l) => l.length > 0).length;

        assertEquals(
          lineCount,
          10_000,
          `mergeStreams must preserve all 10000 lines; got ${lineCount}`,
        );
      },
    );
  },
);
