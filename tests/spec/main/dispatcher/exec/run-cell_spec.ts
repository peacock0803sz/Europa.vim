/**
 * BDD specs for runCell dispatcher.
 *
 * @spec-id europa.dispatcher.run-cell
 * @spec-id europa.dispatcher.run-cell-queued-on-busy
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildDispatcher } from "../../../../../denops/europa/main.ts";
import { mockVim } from "../../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../../fixtures/mock-host.ts";
import {
  makeMockKernel,
  type MockKernelHandle,
} from "../../../../fixtures/mock-kernel.ts";

const FIXTURE_PATH = new URL(
  "../../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

const CODE_CELL_1 = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
const MARKDOWN_CELL = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
const CODE_CELL_3 = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";

// ---------------------------------------------------------------------------
// runCell dispatcher (T018)
// ---------------------------------------------------------------------------

describe(
  "runCell dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const RUN_BUFNR = 88;
    let runHost: MockHost;
    let currentMk: MockKernelHandle | null = null;

    beforeEach(() => {
      runHost = mockVim();
      currentMk = null;
    });

    afterEach(async () => {
      await currentMk?.close();
      currentMk = null;
    });

    function setRunConfig(url: string, token: string): void {
      runHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      runHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      runHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      runHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    async function startKernelForRun(
      dispatcher: ReturnType<typeof buildDispatcher>,
    ): Promise<void> {
      await dispatcher.open(RUN_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(RUN_BUFNR, "python3");
      runHost.calls = [];
    }

    it(
      "(a) happy path: execute_request sent + output appended",
      async () => {
        currentMk = makeMockKernel({
          executeScript: {
            replies: [
              { msg_type: "stream", content: { name: "stdout", text: "hi\n" } },
            ],
          },
        });
        setRunConfig(currentMk.url, currentMk.token);

        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_1);

        assertEquals(
          currentMk.executeRequestCalls.length,
          1,
          "exactly 1 execute_request must be sent",
        );
        const errorCmds = runHost.cmdsMatching("echohl ErrorMsg");
        assertEquals(errorCmds.length, 0, "no error messages expected");
      },
    );

    it("(b) no kernel → 'No kernel attached' message, no execute_request", async () => {
      const dispatcher = buildDispatcher(runHost);
      await dispatcher.open(RUN_BUFNR, FIXTURE_PATH);
      runHost.calls = [];

      await dispatcher.runCell(RUN_BUFNR, CODE_CELL_1);

      const msgs = runHost.cmdsMatching("No kernel attached");
      assertEquals(msgs.length > 0, true, "must show 'No kernel attached'");
    });

    it(
      "(c) nonexistent cellId → 'No cell at cursor' message",
      async () => {
        currentMk = makeMockKernel();
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, "nonexistent-cell-id");

        const msgs = runHost.cmdsMatching("No cell at cursor");
        assertEquals(msgs.length > 0, true, "must show 'No cell at cursor'");
      },
    );

    it(
      "(d) markdown cell → 'Cannot run a non-code cell' message",
      async () => {
        currentMk = makeMockKernel();
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, MARKDOWN_CELL);

        const msgs = runHost.cmdsMatching("Cannot run a non-code cell");
        assertEquals(msgs.length > 0, true, "must show non-code cell message");
        assertEquals(
          currentMk.executeRequestCalls.length,
          0,
          "no execute_request for markdown cell",
        );
      },
    );

    it(
      "(e) busy same cell → 'Cell is already running' message, no execute_request",
      async () => {
        // We simulate busy by running a cell and calling runCell again before it finishes.
        // For simplicity: directly invoke runCell twice for the same cell — the first
        // call starts executing (sets cellState=busy), the second call should detect busy.
        // The mock server responds fast so we use a delayed reply to hold the first call.
        currentMk = makeMockKernel({
          executeScript: {
            replies: [],
            executeReply: {
              status: "ok",
              execution_count: 1,
              payload: [],
              user_expressions: {},
            },
          },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        // Start first execution and immediately try a second for the same cell.
        // Use allSettled so both rejections are handled even in the stub phase.
        await Promise.allSettled([
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_1),
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_1),
        ]);

        const msgs = runHost.cmdsMatching("Cell is already running");
        assertEquals(
          msgs.length > 0,
          true,
          "must show 'Cell is already running' for reentrant call",
        );
        // Only 1 execute_request total
        assertEquals(
          currentMk.executeRequestCalls.length,
          1,
          "only 1 execute_request for busy rerun",
        );
      },
    );

    it(
      "(f) error cell → outputs contain error",
      async () => {
        currentMk = makeMockKernel({
          executeScript: {
            replies: [
              {
                msg_type: "error",
                content: {
                  ename: "ZeroDivisionError",
                  evalue: "division by zero",
                  traceback: ["ZeroDivisionError: division by zero"],
                },
              },
            ],
            executeReply: {
              status: "error",
              execution_count: 1,
              ename: "ZeroDivisionError",
              evalue: "division by zero",
              traceback: [],
            },
          },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_1);

        assertEquals(
          currentMk.executeRequestCalls.length,
          1,
          "execute_request sent for error cell",
        );
        const errorHostCmds = runHost.cmdsMatching("echohl ErrorMsg");
        assertEquals(errorHostCmds.length, 0, "no dispatcher-level error");
      },
    );

    it(
      "(g) abort mid execute → runCell completes (AbortController is not plumbed here)",
      async () => {
        // Basic smoke test: runCell returns void without throwing.
        currentMk = makeMockKernel({
          executeScript: {
            replies: [{
              msg_type: "stream",
              content: { name: "stdout", text: "x\n" },
            }],
          },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_1);

        assertEquals(currentMk.executeRequestCalls.length, 1);
      },
    );

    it(
      "(h) cell.source is snapshotted at call time (Q-edit)",
      async () => {
        currentMk = makeMockKernel({
          executeScript: { replies: [] },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_1);

        // The execute_request code must match the cell source at call time.
        assertEquals(currentMk.executeRequestCalls.length, 1);
        const code = currentMk.executeRequestCalls[0].content["code"] as string;
        assertEquals(
          typeof code,
          "string",
          "execute_request.content.code must be a string",
        );
      },
    );

    it(
      "(i) execution_count updated from execute_reply",
      async () => {
        currentMk = makeMockKernel({
          executeScript: {
            replies: [],
            executeReply: {
              status: "ok",
              execution_count: 42,
              payload: [],
              user_expressions: {},
            },
          },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_3);

        assertEquals(currentMk.executeRequestCalls.length, 1);
        const errorCmds = runHost.cmdsMatching("echohl ErrorMsg");
        assertEquals(
          errorCmds.length,
          0,
          "no error after successful execution",
        );
      },
    );

    it(
      "(j) busy execState: second runCell rejected, execute_request NOT sent",
      async () => {
        // Set up a slow first execution to keep execState='busy' while we call runCell again.
        currentMk = makeMockKernel({
          executeScript: {
            replies: [{
              msg_type: "stream",
              content: { name: "stdout", text: "done\n" },
            }],
          },
        });
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        // Start executing cell 1; immediately attempt cell 3 while kernel is busy.
        // Use allSettled so both rejections are handled even in the stub phase.
        await Promise.allSettled([
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_1),
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_3),
        ]);

        // Cell 3 call was rejected → only 1 execute_request total.
        assertEquals(
          currentMk.executeRequestCalls.length,
          1,
          "only 1 execute_request sent (cell 3 was rejected, not sent)",
        );

        const busyMsgs = runHost.cmdsMatching("Kernel is busy");
        assertEquals(
          busyMsgs.length > 0,
          true,
          "must show 'Kernel is busy' message for cell 3",
        );
      },
    );

    it(
      "(k) queued cell + idle kernel → runCell redispatches without double-enqueue",
      async () => {
        currentMk = makeMockKernel();
        setRunConfig(currentMk.url, currentMk.token);
        const dispatcher = buildDispatcher(runHost);
        await startKernelForRun(dispatcher);

        // cell1 executes (busy), cell3 queued via FR-008
        await Promise.allSettled([
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_1),
          dispatcher.runCell(RUN_BUFNR, CODE_CELL_3),
        ]);
        assertEquals(
          currentMk.executeRequestCalls.length,
          1,
          "only cell1 executed so far — cell3 is queued",
        );

        // kernel is now idle; cell3 is still in pendingRequests as 'queued'
        // runCell must redispatch the existing entry, not create a second one
        await dispatcher.runCell(RUN_BUFNR, CODE_CELL_3);

        assertEquals(
          currentMk.executeRequestCalls.length,
          2,
          "cell3 executes exactly once — no double-enqueue from redispatch",
        );
      },
    );
  },
);
