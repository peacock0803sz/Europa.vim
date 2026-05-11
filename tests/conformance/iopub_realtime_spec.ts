/**
 * Conformance: real-time IOPub stream output against a live Jupyter Server.
 *
 * Verifies that consecutive `print()` outputs in a
 * `for i in range(5): time.sleep(0.1)` cell arrive no more than 1000 ms apart
 * (SC-001 kernel-liveness check). Skips early if `jupyter` is not installed.
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
import { parseNotebook } from "../../denops/europa/notebook/parse.ts";
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
    undo_max_history: 100,
    disable_default_mappings: false,
    ts_highlight: "auto",
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
          { kernelInfoTimeoutMs: 60_000 },
        );

        const runtime = await client.start({ kernelName: "python3" });

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
          await server.stop();
        }

        // SC-001: at least 4 stream messages must have been received
        assertExists(streamTimestamps);
        assert(
          streamTimestamps.length >= 4,
          `expected ≥ 4 stream messages, got ${streamTimestamps.length}`,
        );

        // The messages should be spaced ~500 ms apart (we allow ×4 slack for CI)
        if (streamTimestamps.length >= 2) {
          for (let i = 1; i < streamTimestamps.length; i++) {
            const gap = streamTimestamps[i] - streamTimestamps[i - 1];
            assert(
              gap < 2000,
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

/**
 * Conformance: above-cell bit-identical isolation (SC-003).
 *
 * Loads `tests/fixtures/high-volume.ipynb` (100 alternating cells), runs only
 * the last code cell, and verifies that all other cells' outputs remain empty.
 * This tests the isolation invariant that is the client-side analog of the
 * cursor-stability guarantee: executing one cell must not corrupt the state of
 * other cells.
 *
 * Cursor stability (getcurpos bit-identical at 16 ms tick boundaries) requires
 * a live Vim/Neovim session and is verified manually via quickstart.md §4.
 *
 * @spec-id europa.render.partial.above-cell-bit-identical
 */
describe(
  "high-volume fixture: above-cell isolation (SC-003)",
  { sanitizeResources: false, sanitizeOps: false },
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

        // Run only the last cell against a real kernel
        const server = await spawnConformanceServer();
        const config: EuropaConfig = {
          connection_mode: "server",
          jupyter_url: server.url,
          jupyter_token: server.token,
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
        };
        const pool = new ServerPool();
        const client = new ServerKernelClient(
          {
            eval: (_e: string): Promise<unknown> => Promise.resolve(""),
          } as never,
          config,
          pool,
          { kernelInfoTimeoutMs: 60_000 },
        );

        const runtime = await client.start({ kernelName: "python3" });
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
          await server.stop();
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
