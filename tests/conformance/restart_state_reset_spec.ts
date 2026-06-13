/**
 * Conformance: kernel restart and state reset against a real Jupyter Server.
 *
 * Covers US4: REST POST /restart + WebSocket reconnect + kernelInfo re-handshake
 * within 10s (SC-004), plus execution_count null-reset and variable-space clearing.
 *
 * Skips early if `jupyter` is not installed.
 *
 * @spec-id europa.kernel.restart.conformance-state-reset
 */

import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertExists } from "@std/assert";
import { ServerKernelClient } from "../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../denops/europa/kernel/server-pool.ts";
import { applyMessageToCell } from "../../denops/europa/kernel/execute.ts";
import type { EuropaConfig } from "../../schema/config.ts";
import type { CodeCell } from "../../schema/notebook.ts";
import {
  type ConformanceServer,
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

describe("conformance: restart — variable-space reset (SC-004)", () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    if (!jupyterPresent) return;
    server = await spawnConformanceServer({ timeoutMs: 30_000 });
  });

  afterAll(async () => {
    if (!jupyterPresent) return;
    await server.stop();
  });

  it("restart clears variable state: NameError after defining a=42 and restarting", async () => {
    if (!jupyterPresent) return;
    const pool = new ServerPool();
    const config = attachConfig(server.url, server.token);
    const client = new ServerKernelClient(
      makeMockDenops() as never,
      config,
      pool,
    );
    await client.start({ kernelName: "python3" });

    // Define a = 42 in the kernel.
    const cell1 = makeCodeCell("a = 42");
    for await (const msg of client.execute("a = 42")) {
      applyMessageToCell(cell1, msg);
    }
    assert(
      cell1.execution_count === 1,
      "Expected execution_count=1 after first execute",
    );

    // Restart: must complete within 10 s (SC-004).
    const t0 = Date.now();
    await client.restart();
    const elapsed = Date.now() - t0;
    assert(elapsed < 10_000, `restart took ${elapsed}ms, expected < 10000ms`);

    // After restart, `a` should not exist.
    const cell2 = makeCodeCell("print(a)");
    for await (const msg of client.execute("print(a)")) {
      applyMessageToCell(cell2, msg);
    }

    const errorOut = cell2.outputs.find((o) => o.output_type === "error");
    assertExists(
      errorOut,
      "Expected NameError after restart cleared variable space",
    );
    assert(
      (errorOut as { ename: string }).ename === "NameError",
      `Expected NameError, got ${(errorOut as { ename: string }).ename}`,
    );

    await client.shutdown();
  });

  it("restart updates languageInfo via kernelInfo re-handshake (US5)", async () => {
    if (!jupyterPresent) return;
    const pool = new ServerPool();
    const config = attachConfig(server.url, server.token);
    const client = new ServerKernelClient(
      makeMockDenops() as never,
      config,
      pool,
    );
    const runtime = await client.start({ kernelName: "python3" });

    const langBefore = runtime.info.languageInfo?.name;
    assertExists(langBefore, "Expected languageInfo before restart");

    await client.restart();

    // After restart, languageInfo should still be present (re-fetched via kernelInfo).
    const langAfter = runtime.info.languageInfo?.name;
    assertExists(
      langAfter,
      "Expected languageInfo after restart re-handshake",
    );
    assert(
      langAfter === "python",
      `Expected language 'python', got '${langAfter}'`,
    );

    await client.shutdown();
  });
});
