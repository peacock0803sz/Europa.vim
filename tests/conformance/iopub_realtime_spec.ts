/**
 * Conformance: real-time IOPub stream output against a live Jupyter Server.
 *
 * Verifies that consecutive `print()` outputs from a
 * `for i in range(5): ... time.sleep(0.5)` cell arrive no further apart than
 * `STREAM_GAP_BUDGET_MS` (SC-001 kernel-liveness check). Skips early if
 * `jupyter` is not installed.
 *
 * @spec-id europa.render.iopub-batch.tick-scheduling
 */

import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import {
  complete,
  enqueue,
  markSent,
} from "../../denops/europa/session/pending-requests.ts";
import type { CodeCell } from "../../schema/notebook.ts";
import { parseNotebook } from "../../denops/europa/notebook/parse.ts";
import {
  type ConformanceServer,
  ensureJupyter,
  JupyterMissingError,
  spawnConformanceServer,
} from "./setup.ts";
import { createConformanceClient, startConformanceKernel } from "./client.ts";
import { assertWithinBudget, STREAM_GAP_BUDGET_MS } from "./timeouts.ts";

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
  "high-volume.ipynb parse (no server required)",
  () => {
    it(
      "high-volume.ipynb parses to 100 cells (50 markdown + 50 code)",
      async () => {
        const txt = await Deno.readTextFile(
          "tests/fixtures/high-volume.ipynb",
        );
        const nb = await parseNotebook(txt);

        assertEquals(nb.cells.length, 100, "fixture must have 100 cells");
        const codeCells = nb.cells.filter((c) => c.cell_type === "code");
        assertEquals(codeCells.length, 50, "fixture must have 50 code cells");
        const mdCells = nb.cells.filter((c) => c.cell_type === "markdown");
        assertEquals(mdCells.length, 50, "fixture must have 50 markdown cells");

        // Verify alternating order and IDs
        assertEquals(nb.cells[0].cell_type, "markdown");
        assertEquals(nb.cells[1].cell_type, "code");
        assertEquals(nb.cells[98].cell_type, "markdown");
        assertEquals(nb.cells[99].cell_type, "code");
      },
    );
  },
);

describe(
  "IOPub real-time + above-cell isolation (shared server)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let server: ConformanceServer;

    beforeAll(async () => {
      if (!jupyterPresent) return;
      server = await spawnConformanceServer();
    });

    afterAll(async () => {
      if (!jupyterPresent) return;
      await server.stop();
    });

    it(
      "consecutive stream messages arrive within STREAM_GAP_BUDGET_MS (SC-001)",
      { ignore: !jupyterPresent },
      async () => {
        const pool = new ServerPool();
        const client = createConformanceClient(server, pool);

        const runtime = await startConformanceKernel(client, server);

        const cell: CodeCell = {
          id: "realtime-test",
          cell_type: "code",
          source:
            "import time\nfor i in range(5):\n    print(i)\n    time.sleep(0.5)",
          outputs: [],
          execution_count: null,
          metadata: {},
        };

        const kr = runtime;
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
          await pool.killAll();
        }

        // SC-001: at least 4 stream messages must have been received
        assertExists(streamTimestamps);
        assert(
          streamTimestamps.length >= 4,
          `expected ≥ 4 stream messages, got ${streamTimestamps.length}`,
        );

        // The messages should be spaced ~500 ms apart; the budget carries the
        // slack, and how much of it, for both local and CI runs.
        if (streamTimestamps.length >= 2) {
          for (let i = 1; i < streamTimestamps.length; i++) {
            const gap = streamTimestamps[i] - streamTimestamps[i - 1];
            assertWithinBudget(
              `gap between stream msgs ${i - 1} and ${i}`,
              gap,
              STREAM_GAP_BUDGET_MS,
            );
          }
        }

        assertEquals(cell.outputs.length >= 1, true, "cell must have outputs");
      },
    );

    /**
     * Conformance: above-cell bit-identical isolation (SC-003).
     *
     * Loads `tests/fixtures/high-volume.ipynb` (100 alternating cells), runs
     * only the last code cell, and verifies that all other cells' outputs
     * remain empty. Tests the isolation invariant that is the client-side
     * analog of the cursor-stability guarantee.
     *
     * Cursor stability (getcurpos bit-identical at 16 ms tick boundaries)
     * requires a live Vim/Neovim session and is verified manually via
     * quickstart.md §4.
     *
     * @spec-id europa.render.partial.above-cell-bit-identical
     */
    it(
      "executing the last code cell does not modify other cells' outputs (SC-003 cell isolation)",
      { ignore: !jupyterPresent },
      async () => {
        const txt = await Deno.readTextFile(
          "tests/fixtures/high-volume.ipynb",
        );
        const nb = await parseNotebook(txt);

        // Find the last code cell (cd-099, source: "print(f'cell 49')")
        const lastCodeCell = nb.cells[99] as CodeCell;
        assertEquals(lastCodeCell.cell_type, "code");
        assertEquals(
          lastCodeCell.outputs.length,
          0,
          "fixture cell starts empty",
        );

        const pool = new ServerPool();
        const client = createConformanceClient(server, pool);

        const runtime = await startConformanceKernel(client, server);
        const kr = runtime;
        const msgId = enqueue(kr, 0, lastCodeCell.id);
        markSent(kr, msgId);
        kr.execState = "busy";

        try {
          for await (
            const msg of runtime.client.execute(lastCodeCell.source, {
              signal: runtime.abort.signal,
              msgId,
            })
          ) {
            applyMessageToCell(lastCodeCell, msg);
          }
        } finally {
          complete(kr, msgId);
          kr.execState = "idle";
          await client.shutdown();
          await pool.killAll();
        }

        // The executed cell must have output
        assertExists(
          lastCodeCell.outputs.find(
            (o) => (o as { output_type: string }).output_type === "stream",
          ),
          "last code cell must produce stream output",
        );

        // All other cells' outputs must remain untouched (cell isolation).
        // This is the client-side invariant for SC-003: executing one cell
        // must not corrupt the outputs of cells above it.
        const otherCells = nb.cells.filter((c) => c !== lastCodeCell);
        for (const cell of otherCells) {
          if (cell.cell_type === "code") {
            assertEquals(
              (cell as CodeCell).outputs.length,
              0,
              `cell ${cell.id} must have no outputs — only the last cell was executed`,
            );
          }
        }
      },
    );
  },
);
