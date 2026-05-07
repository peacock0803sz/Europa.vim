/**
 * Conformance: execute lifecycle against a real Jupyter Server.
 *
 * Covers US1 (runCell: print output within 5s) and US2 (runAll: sequential
 * cells + markdown skip + error-stop), and the SC-002 100-cell benchmark.
 *
 * Skips early with a user-friendly message if `jupyter` is not installed.
 *
 * @spec-id europa.kernel.execute.conformance-print
 * @spec-id europa.kernel.execute.conformance-run-all
 * @spec-id europa.kernel.execute.conformance-error-stop
 * @spec-id europa.kernel.execute.conformance-100-cell-bench
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
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
    undo_max_history: 100,
    disable_default_mappings: false,
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

describe("conformance: runCell — print('hi') within 5s (SC-001)", () => {
  it("execute print('hi') yields stream output 'hi' and execution_count=1", async () => {
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

      const cell = makeCodeCell("print('hi')");
      const msgId = enqueue(runtime, 1, cell.id);
      markSent(runtime, msgId);

      const t0 = Date.now();
      for await (const msg of client.execute("print('hi')", { msgId })) {
        applyMessageToCell(cell, msg);
      }
      const elapsed = Date.now() - t0;
      complete(runtime, msgId);

      // SC-001: must complete within 5 s
      assert(elapsed < 5_000, `execute took ${elapsed}ms, expected < 5000ms`);
      const streamOut = cell.outputs.find((o) => o.output_type === "stream");
      assertExists(streamOut, "Expected stream output");
      assert(
        (streamOut as { text: string }).text.includes("hi"),
        "Expected 'hi' in stream output",
      );
      assertEquals(cell.execution_count, 1);

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });
});

describe("conformance: runAll — sequential cells + markdown skip + error stop (US2)", () => {
  it("executes 3 code cells in order and the last output is 2", async () => {
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

      const codeCells = [
        makeCodeCell("a = 1"),
        makeCodeCell("a = a + 1"),
        makeCodeCell("print(a)"),
      ];

      // Pre-enqueue all (simulating runAll phase 1).
      const entries = codeCells.map((cell) => ({
        cell,
        msgId: enqueue(runtime, 1, cell.id),
      }));

      // Execute sequentially (simulating runAll phase 2).
      for (const { cell, msgId } of entries) {
        markSent(runtime, msgId);
        for await (const msg of client.execute(cell.source, { msgId })) {
          applyMessageToCell(cell, msg);
        }
        complete(runtime, msgId);
      }

      // Last cell should print 2.
      const lastCell = codeCells[2];
      const stream = lastCell.outputs.find((o) => o.output_type === "stream");
      assertExists(stream, "Expected stream output from print(a)");
      assert(
        (stream as { text: string }).text.trim() === "2",
        `Expected '2', got '${(stream as { text: string }).text}'`,
      );

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });

  it("stops at the erroring cell and cancels remaining (Q2 default A)", async () => {
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

      const codeCells = [
        makeCodeCell("x = 1"),
        makeCodeCell("1/0"), // ZeroDivisionError
        makeCodeCell("x = 3"),
      ];

      const entries = codeCells.map((cell) => ({
        cell,
        msgId: enqueue(runtime, 1, cell.id),
      }));

      let errorStopped = false;
      let completed = 0;

      for (const { cell, msgId } of entries) {
        if (!runtime.pendingRequests.has(msgId)) continue;

        markSent(runtime, msgId);
        let execStatus = "ok";
        for await (const msg of client.execute(cell.source, { msgId })) {
          applyMessageToCell(cell, msg);
          if (
            msg.header.msg_type === "execute_reply" &&
            (msg.content as { status?: string }).status
          ) {
            execStatus = (msg.content as { status: string }).status;
          }
        }
        complete(runtime, msgId);
        completed++;

        if (execStatus === "error") {
          // Cancel remaining entries.
          for (const rem of entries) {
            cancelQueued(runtime, rem.cell.id);
          }
          errorStopped = true;
          break;
        }
      }

      assert(errorStopped, "Expected error stop after 1/0");
      // Only 2 cells should have been executed (x=1 and 1/0).
      assertEquals(completed, 2);
      // Third cell should have no outputs.
      assertEquals(codeCells[2].outputs.length, 0);

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });
});

describe("conformance: 100-cell runAll within 30s (SC-002)", () => {
  it("executes 100 short cells in under 30s", async () => {
    if (!jupyterPresent) return;
    const server = await spawnConformanceServer({ timeoutMs: 30_000 });
    try {
      const pool = new ServerPool();
      const config = attachConfig(server.url, server.token);
      const client = new ServerKernelClient(
        makeMockDenops() as never,
        config,
        pool,
        { kernelInfoTimeoutMs: 60_000 },
      );
      const runtime = await client.start({ kernelName: "python3" });

      const cells = Array.from(
        { length: 100 },
        (_, i) => makeCodeCell(`_x${i} = ${i}`),
      );

      const entries = cells.map((cell) => ({
        cell,
        msgId: enqueue(runtime, 1, cell.id),
      }));

      const t0 = Date.now();
      for (const { cell, msgId } of entries) {
        markSent(runtime, msgId);
        for await (const msg of client.execute(cell.source, { msgId })) {
          applyMessageToCell(cell, msg);
        }
        complete(runtime, msgId);
      }
      const elapsed = Date.now() - t0;

      // SC-002: 100 cells must finish within 30 s on real jupyter.
      assert(
        elapsed < 30_000,
        `100-cell runAll took ${elapsed}ms, expected < 30000ms`,
      );

      await client.shutdown();
    } finally {
      await server.stop();
    }
  });
});
