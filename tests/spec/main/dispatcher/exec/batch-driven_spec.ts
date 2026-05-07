/**
 * BDD specs for batch-driven runCell, runAll, and cellops-flush-on-entry dispatcher.
 *
 * @spec-id europa.dispatcher.runcell-batch-driven
 * @spec-id europa.dispatcher.runall-batch-driven
 * @spec-id europa.dispatcher.cellops-flush-on-entry
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildDispatcher } from "../../../../../denops/europa/main.ts";
import { mockVim } from "../../../../fixtures/mock-host.ts";
import {
  makeMockKernel,
  type MockKernelHandle,
} from "../../../../fixtures/mock-kernel.ts";

// ---------------------------------------------------------------------------
// Phase 3.4: batch-driven runCell / runAll / cellops-flush (T010)
// ---------------------------------------------------------------------------

const BATCH_FIXTURE_PATH = new URL(
  "../../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;
const BATCH_CODE_CELL = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
const BATCH_ANCHOR_CELL = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";
const BATCH_BUFNR = 77;

describe(
  "runCell batch-driven (runcell-batch-driven)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let batchHost: ReturnType<typeof mockVim>;
    let mk: MockKernelHandle | null = null;

    beforeEach(() => {
      batchHost = mockVim();
    });

    afterEach(async () => {
      await mk?.close();
      mk = null;
    });

    function setConfig(url: string, token: string) {
      batchHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      batchHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it(
      "batch call is made during execution (scheduler dispatches partial render per tick)",
      async () => {
        mk = makeMockKernel({
          executeScript: {
            replies: [
              { msg_type: "stream", content: { name: "stdout", text: "a\n" } },
              { msg_type: "stream", content: { name: "stdout", text: "b\n" } },
              { msg_type: "stream", content: { name: "stdout", text: "c\n" } },
            ],
            replyIntervalMs: 20, // staggered stream: crosses 16ms tick boundary
          },
        });
        setConfig(mk.url, mk.token);

        const dispatcher = buildDispatcher(batchHost);
        await dispatcher.open(BATCH_BUFNR, BATCH_FIXTURE_PATH);
        await dispatcher.startKernel(BATCH_BUFNR, "python3");
        batchHost.calls = [];

        await dispatcher.runCell(BATCH_BUFNR, BATCH_CODE_CELL);

        // After Phase 3.4: scheduler wires into execute loop → batch() called ≥ 1
        const batchCalls = batchHost.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchCalls.length >= 1,
          true,
          "at least one scheduler-driven batch flush must occur during runCell",
        );
      },
    );
  },
);

describe(
  "runAll batch-driven (runall-batch-driven)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let batchHost: ReturnType<typeof mockVim>;
    let mk: MockKernelHandle | null = null;

    beforeEach(() => {
      batchHost = mockVim();
    });

    afterEach(async () => {
      await mk?.close();
      mk = null;
    });

    function setConfig(url: string, token: string) {
      batchHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      batchHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it(
      "batch call is made for each cell during runAll",
      async () => {
        mk = makeMockKernel({
          executeScript: {
            replies: [
              {
                msg_type: "stream",
                content: { name: "stdout", text: "row\n" },
              },
            ],
          },
        });
        setConfig(mk.url, mk.token);

        const dispatcher = buildDispatcher(batchHost);
        await dispatcher.open(BATCH_BUFNR, BATCH_FIXTURE_PATH);
        await dispatcher.startKernel(BATCH_BUFNR, "python3");
        batchHost.calls = [];

        await dispatcher.runAll(BATCH_BUFNR);

        const batchCalls = batchHost.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchCalls.length >= 1,
          true,
          "at least one batch flush must occur across runAll cells",
        );
      },
    );
  },
);

describe(
  "cellops flush-on-entry (cellops-flush-on-entry)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let batchHost: ReturnType<typeof mockVim>;
    let mk: MockKernelHandle | null = null;

    beforeEach(() => {
      batchHost = mockVim();
    });

    afterEach(async () => {
      await mk?.close();
      mk = null;
    });

    function setConfig(url: string, token: string) {
      batchHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      batchHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      batchHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it(
      "insertCell completes successfully while kernel is busy (flushNow called on entry)",
      async () => {
        mk = makeMockKernel({
          executeScript: {
            replies: [
              { msg_type: "stream", content: { name: "stdout", text: "x\n" } },
              { msg_type: "stream", content: { name: "stdout", text: "y\n" } },
            ],
            replyIntervalMs: 30,
          },
        });
        setConfig(mk.url, mk.token);

        const dispatcher = buildDispatcher(batchHost);
        await dispatcher.open(BATCH_BUFNR, BATCH_FIXTURE_PATH);
        await dispatcher.startKernel(BATCH_BUFNR, "python3");

        // Kick off a cell in background so the scheduler is active during insertCell
        const runPromise = dispatcher.runCell(BATCH_BUFNR, BATCH_CODE_CELL);
        await new Promise((r) => setTimeout(r, 80));

        // insertCell must call flushNow on entry, then proceed with its own render.
        // Whether the queue is empty at that moment (scheduler may have auto-flushed)
        // or not, insertCell must complete without error.
        await dispatcher.insertCell(
          BATCH_BUFNR,
          "code",
          "after",
          BATCH_ANCHOR_CELL,
        );

        // insertCell's applyRenderPlan must have run (setbufline called)
        const setbuflineCalls = batchHost.callsTo("setbufline");
        assertEquals(
          setbuflineCalls.length >= 1,
          true,
          "insertCell must complete and call setbufline via its own applyRenderPlan",
        );

        // At least one scheduler batch flush must have occurred across the sequence
        const batchCalls = batchHost.calls.filter((c) => c.method === "batch");
        assertEquals(
          batchCalls.length >= 1,
          true,
          "at least one scheduler batch flush must have occurred during execution",
        );

        await runPromise;
      },
    );
  },
);
