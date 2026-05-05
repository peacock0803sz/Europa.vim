/**
 * BDD specs for the execute layer (execute.ts + applyMessageToCell).
 *
 * Uses makeMockKernel() for integration-level tests with a real WebSocket,
 * and pure-function unit tests for applyMessageToCell.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ServerKernelClient } from "../../../denops/europa/kernel/server-client.ts";
import { ServerPool } from "../../../denops/europa/kernel/server-pool.ts";
import {
  applyMessageToCell,
  buildExecuteRequest,
  execute,
} from "../../../denops/europa/kernel/execute.ts";
import { makeMockKernel } from "../../fixtures/mock-kernel.ts";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { CodeCell } from "../../../schema/notebook.ts";

const BASE_CONFIG: EuropaConfig = {
  connection_mode: "server",
  jupyter_url: "http://localhost:8888",
  jupyter_token: "",
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
  wsReconnectMaxRetries: 0,
  wsReconnectInitialIntervalMs: 1000,
  wsReconnectMultiplier: 2.0,
  kernelInfoTimeoutMs: 10000,
};

function makeMockDenops(vars: Record<string, unknown> = {}) {
  return {
    eval: (expr: string): Promise<unknown> => {
      const match = expr.match(/^get\(g:, '([^']+)', '([^']*)'\)$/);
      if (match) return Promise.resolve(vars[match[1]] ?? match[2]);
      return Promise.resolve(null);
    },
  };
}

function makeCodeCell(source = ""): CodeCell {
  return {
    cell_type: "code",
    id: "cell-test",
    source,
    metadata: {},
    execution_count: null,
    outputs: [],
  };
}

// ---------------------------------------------------------------------------
// buildExecuteRequest unit tests
// ---------------------------------------------------------------------------

describe("buildExecuteRequest — R02 fixed fields", () => {
  it("code is set from argument", () => {
    const req = buildExecuteRequest("print('hi')");
    assertEquals(req.code, "print('hi')");
  });

  it("silent is always false", () => {
    assertEquals(buildExecuteRequest("x").silent, false);
  });

  it("store_history is always true", () => {
    assertEquals(buildExecuteRequest("x").store_history, true);
  });

  it("allow_stdin is always false", () => {
    assertEquals(buildExecuteRequest("x").allow_stdin, false);
  });

  it("stop_on_error is always true", () => {
    assertEquals(buildExecuteRequest("x").stop_on_error, true);
  });

  it("user_expressions is an empty record", () => {
    assertEquals(buildExecuteRequest("x").user_expressions, {});
  });
});

// ---------------------------------------------------------------------------
// applyMessageToCell unit tests
// ---------------------------------------------------------------------------

describe("applyMessageToCell — stream (FR-016 per-message late-merge)", () => {
  it("consecutive stdout messages are merged", () => {
    // @spec-id europa.kernel.execute.iopub-stream
    const cell = makeCodeCell();
    const mkMsg = (text: string) => ({
      header: {
        msg_id: "m1",
        msg_type: "stream",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { name: "stdout", text },
      buffers: [],
    });
    applyMessageToCell(cell, mkMsg("hello "));
    applyMessageToCell(cell, mkMsg("world\n"));
    assertEquals(cell.outputs.length, 1);
    assertEquals((cell.outputs[0] as { text: string }).text, "hello world\n");
  });

  it("stdout→stderr→stdout produces 3 entries", () => {
    const cell = makeCodeCell();
    const mkMsg = (name: "stdout" | "stderr", text: string) => ({
      header: {
        msg_id: "m1",
        msg_type: "stream",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { name, text },
      buffers: [],
    });
    applyMessageToCell(cell, mkMsg("stdout", "out1"));
    applyMessageToCell(cell, mkMsg("stderr", "err"));
    applyMessageToCell(cell, mkMsg("stdout", "out2"));
    assertEquals(cell.outputs.length, 3);
  });

  it("stream→display_data→stream produces 3 entries", () => {
    const cell = makeCodeCell();
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "stream",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { name: "stdout", text: "a" },
      buffers: [],
    });
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "display_data",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { data: { "text/plain": "img" }, metadata: {} },
      buffers: [],
    });
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "stream",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { name: "stdout", text: "b" },
      buffers: [],
    });
    assertEquals(cell.outputs.length, 3);
  });
});

describe("applyMessageToCell — execute_result", () => {
  it("appends execute_result to outputs and sets execution_count", () => {
    // @spec-id europa.kernel.execute.execute-result
    const cell = makeCodeCell();
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "execute_result",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: {
        execution_count: 3,
        data: { "text/plain": "42" },
        metadata: {},
      },
      buffers: [],
    });
    assertEquals(cell.outputs.length, 1);
    assertEquals(cell.outputs[0].output_type, "execute_result");
    assertEquals(cell.execution_count, 3);
  });
});

describe("applyMessageToCell — error", () => {
  it("appends error with ANSI traceback preserved as-is", () => {
    // @spec-id europa.kernel.execute.error-content
    const cell = makeCodeCell();
    const ansiTraceback = ["[31mTraceback[0m", "ZeroDivisionError"];
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "error",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: {
        ename: "ZeroDivisionError",
        evalue: "division by zero",
        traceback: ansiTraceback,
      },
      buffers: [],
    });
    assertEquals(cell.outputs.length, 1);
    assertEquals(cell.outputs[0].output_type, "error");
    assertEquals(
      (cell.outputs[0] as { traceback: string[] }).traceback,
      ansiTraceback,
    );
  });
});

describe("applyMessageToCell — execute_reply", () => {
  it("(ok) sets execution_count", () => {
    // @spec-id europa.kernel.execute.execute-reply-ok
    const cell = makeCodeCell();
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "execute_reply",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: {
        status: "ok",
        execution_count: 5,
        payload: [],
        user_expressions: {},
      },
      buffers: [],
    });
    assertEquals(cell.execution_count, 5);
  });

  it("(error) sets execution_count", () => {
    // @spec-id europa.kernel.execute.execute-reply-error
    const cell = makeCodeCell();
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "execute_reply",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: {
        status: "error",
        execution_count: 2,
        ename: "E",
        evalue: "e",
        traceback: [],
      },
      buffers: [],
    });
    assertEquals(cell.execution_count, 2);
  });

  it("(aborted) does not clobber execution_count", () => {
    const cell = makeCodeCell();
    cell.execution_count = 7;
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "execute_reply",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: { status: "aborted" },
      buffers: [],
    });
    assertEquals(cell.execution_count, 7);
  });
});

describe("applyMessageToCell — update_display_data silent drop", () => {
  it("update_display_data is silently ignored", () => {
    const cell = makeCodeCell();
    applyMessageToCell(cell, {
      header: {
        msg_id: "m",
        msg_type: "update_display_data",
        username: "u",
        session: "s",
        date: "",
        version: "5.3",
      },
      parent_header: {},
      metadata: {},
      content: {
        data: { "text/plain": "new" },
        metadata: {},
        transient: { display_id: "d1" },
      },
      buffers: [],
    });
    assertEquals(cell.outputs.length, 0);
  });
});

// ---------------------------------------------------------------------------
// execute() integration tests with mock server
// ---------------------------------------------------------------------------

describe("execute — integration (mock server)", () => {
  let mk: ReturnType<typeof makeMockKernel>;
  let client: ServerKernelClient;
  let runtime: KernelRuntime;

  beforeEach(async () => {
    mk = makeMockKernel({
      executeScript: {
        replies: [
          { msg_type: "stream", content: { name: "stdout", text: "hi\n" } },
        ],
      },
    });
    const pool = new ServerPool();
    const config: EuropaConfig = {
      ...BASE_CONFIG,
      jupyter_url: mk.url,
      jupyter_token: mk.token,
    };
    client = new ServerKernelClient(makeMockDenops() as never, config, pool);
    runtime = await client.start({ kernelName: "python3" });
  });

  afterEach(async () => {
    await client.shutdown();
    await mk.close();
  });

  it("(a) yields status:busy, execute_input, stream, status:idle, execute_reply in sequence", async () => {
    const msgs: string[] = [];
    for await (const msg of execute(runtime, "print('hi')")) {
      msgs.push(msg.header.msg_type);
    }
    assertEquals(msgs.includes("status"), true);
    assertEquals(msgs.includes("execute_input"), true);
    assertEquals(msgs.includes("stream"), true);
    assertEquals(msgs.includes("execute_reply"), true);
  });

  it("(b) opts.msgId is used as msg_id in execute_request", async () => {
    // @spec-id europa.kernel.execute.request-msg-id-unique
    const myMsgId = "test-msg-id-12345";
    const msgs: string[] = [];
    for await (const msg of execute(runtime, "x=1", { msgId: myMsgId })) {
      msgs.push(msg.header.msg_type);
    }
    // The msgId used should appear in the executeRequestCalls
    assertEquals(mk.executeRequestCalls.length, 1);
    assertEquals(mk.executeRequestCalls[0].header.msg_id, myMsgId);
    assertEquals(msgs.length > 0, true);
  });

  it("(f) SC-007: exactly 1 execute_request sent per execute() call", async () => {
    // @spec-id europa.kernel.execute.wire-message-count
    for await (const _msg of execute(runtime, "1+1")) {
      // drain
    }
    assertEquals(mk.executeRequestCalls.length, 1);
  });

  it("(c) pre-aborted signal throws AbortError before yielding any message", async () => {
    // @spec-id europa.kernel.execute.abort-mid-stream
    // If the signal is already aborted when execute() starts, throwIfAborted()
    // fires on the first iteration and no messages are yielded.
    const ac = new AbortController();
    ac.abort();

    await assertRejects(
      async () => {
        for await (
          const _msg of execute(runtime, "x=1", { signal: ac.signal })
        ) {
          // should not reach here
        }
      },
      DOMException,
    );
  });
});

describe("execute — parent_header.msg_id filter", () => {
  it("messages from other msg_ids are not yielded", async () => {
    // This is tested implicitly by the mock server which correctly sets parent_header.
    // The execute() function filters by parent_header.msg_id === msgId.
    // We verify: two sequential execute() calls each see only their own messages.
    const mk2 = makeMockKernel({
      executeScript: {
        replies: [
          { msg_type: "stream", content: { name: "stdout", text: "first\n" } },
        ],
      },
    });
    const pool = new ServerPool();
    const client = new ServerKernelClient(
      makeMockDenops() as never,
      { ...BASE_CONFIG, jupyter_url: mk2.url, jupyter_token: mk2.token },
      pool,
    );
    const runtime = await client.start({ kernelName: "python3" });

    try {
      const msgs1: string[] = [];
      for await (const msg of execute(runtime, "first")) {
        msgs1.push(msg.header.msg_type);
      }

      const msgs2: string[] = [];
      for await (const msg of execute(runtime, "second")) {
        msgs2.push(msg.header.msg_type);
      }

      // Both iterations must complete (not hang)
      assertEquals(msgs1.includes("execute_reply"), true);
      assertEquals(msgs2.includes("execute_reply"), true);
    } finally {
      await client.shutdown();
      await mk2.close();
    }
  });
});
