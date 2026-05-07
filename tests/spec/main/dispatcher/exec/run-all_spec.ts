/**
 * BDD specs for runAll and cancelCell dispatcher.
 *
 * @spec-id europa.dispatcher.run-all
 * @spec-id europa.dispatcher.cancel-cell
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
const CODE_CELL_3 = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";
const CODE_CELL_5 = "058f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3f";

// ---------------------------------------------------------------------------
// runAll + cancelCell dispatcher (T028)
// ---------------------------------------------------------------------------

describe(
  "runAll + cancelCell dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const RUN2_BUFNR = 89;
    let run2Host: MockHost;
    let currentMk2: MockKernelHandle | null = null;

    beforeEach(() => {
      run2Host = mockVim();
      currentMk2 = null;
    });

    afterEach(async () => {
      await currentMk2?.close();
      currentMk2 = null;
    });

    function setRun2Config(url: string, token: string): void {
      run2Host.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      run2Host.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      run2Host.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      run2Host.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    async function startKernelForRun2(
      dispatcher: ReturnType<typeof buildDispatcher>,
    ): Promise<void> {
      await dispatcher.open(RUN2_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(RUN2_BUFNR, "python3");
      run2Host.calls = [];
    }

    it(
      "(a) happy path: 3 code cells execute, 2 non-code skipped → completion message",
      async () => {
        currentMk2 = makeMockKernel();
        setRun2Config(currentMk2.url, currentMk2.token);
        const dispatcher = buildDispatcher(run2Host);
        await startKernelForRun2(dispatcher);

        await dispatcher.runAll(RUN2_BUFNR);

        assertEquals(
          currentMk2.executeRequestCalls.length,
          3,
          "exactly 3 execute_requests for 3 code cells",
        );
        const completionMsgs = run2Host.cmdsMatching("Ran 3 code cells");
        assertEquals(
          completionMsgs.length > 0,
          true,
          "must show 'Ran 3 code cells' completion message",
        );
        const skippedMsgs = run2Host.cmdsMatching("skipped 2 non-code");
        assertEquals(
          skippedMsgs.length > 0,
          true,
          "must mention 2 skipped non-code cells",
        );
      },
    );

    it(
      "(b) error stop: cell errors → 'Run all stopped at cell N/M due to error'",
      async () => {
        currentMk2 = makeMockKernel({
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
        setRun2Config(currentMk2.url, currentMk2.token);
        const dispatcher = buildDispatcher(run2Host);
        await startKernelForRun2(dispatcher);

        await dispatcher.runAll(RUN2_BUFNR);

        assertEquals(
          currentMk2.executeRequestCalls.length,
          1,
          "stops after first error — only 1 execute_request sent",
        );
        const stopMsgs = run2Host.cmdsMatching("stopped at cell");
        assertEquals(
          stopMsgs.length > 0,
          true,
          "must show error stop message",
        );
      },
    );

    describe(
      "cancelCell",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it(
          "(d1) queued cell → 'Cancelled queued cell'",
          async () => {
            currentMk2 = makeMockKernel({
              executeScript: { replies: [] },
            });
            setRun2Config(currentMk2.url, currentMk2.token);
            const dispatcher = buildDispatcher(run2Host);
            await startKernelForRun2(dispatcher);

            // cell1 starts executing (busy), cell3 gets queued via FR-008
            await Promise.allSettled([
              dispatcher.runCell(RUN2_BUFNR, CODE_CELL_1),
              dispatcher.runCell(RUN2_BUFNR, CODE_CELL_3),
            ]);
            // cell3 is now in pendingRequests with state='queued'

            run2Host.calls = [];
            await dispatcher.cancelCell(RUN2_BUFNR, CODE_CELL_3);

            const msgs = run2Host.cmdsMatching("Cancelled queued cell");
            assertEquals(
              msgs.length > 0,
              true,
              "must show 'Cancelled queued cell'",
            );
          },
        );

        it(
          "(d2) sent (running) cell → 'Cell is already running'",
          async () => {
            currentMk2 = makeMockKernel({
              executeScript: { replies: [] },
            });
            setRun2Config(currentMk2.url, currentMk2.token);
            const dispatcher = buildDispatcher(run2Host);
            await startKernelForRun2(dispatcher);

            // cancelCell for cell1 while cell1 is executing (state='sent')
            await Promise.allSettled([
              dispatcher.runCell(RUN2_BUFNR, CODE_CELL_1),
              dispatcher.cancelCell(RUN2_BUFNR, CODE_CELL_1),
            ]);

            const msgs = run2Host.cmdsMatching("Cell is already running");
            assertEquals(
              msgs.length > 0,
              true,
              "must show 'Cell is already running' for sent cell",
            );
          },
        );

        it(
          "(d3) idle cell (completed) → 'Cell is not queued'",
          async () => {
            currentMk2 = makeMockKernel();
            setRun2Config(currentMk2.url, currentMk2.token);
            const dispatcher = buildDispatcher(run2Host);
            await startKernelForRun2(dispatcher);

            await dispatcher.runCell(RUN2_BUFNR, CODE_CELL_1);
            run2Host.calls = [];
            await dispatcher.cancelCell(RUN2_BUFNR, CODE_CELL_1);

            const msgs = run2Host.cmdsMatching("Cell is not queued");
            assertEquals(
              msgs.length > 0,
              true,
              "must show 'Cell is not queued (state=idle)'",
            );
          },
        );

        it(
          "(d4) nonexistent cellId → 'No cell at cursor'",
          async () => {
            currentMk2 = makeMockKernel();
            setRun2Config(currentMk2.url, currentMk2.token);
            const dispatcher = buildDispatcher(run2Host);
            await startKernelForRun2(dispatcher);

            await dispatcher.cancelCell(RUN2_BUFNR, "nonexistent-cell-id");

            const msgs = run2Host.cmdsMatching("No cell at cursor");
            assertEquals(
              msgs.length > 0,
              true,
              "must show 'No cell at cursor' for unknown cellId",
            );
          },
        );
      },
    );

    it(
      "(e) cancel-mid-runAll: cell3 cancelled while queued, cell5 continues",
      async () => {
        currentMk2 = makeMockKernel();
        setRun2Config(currentMk2.url, currentMk2.token);
        const dispatcher = buildDispatcher(run2Host);
        await startKernelForRun2(dispatcher);

        // Start runAll without awaiting — Phase 1 pre-enqueues all code cells,
        // Phase 2 starts executing cell1 and hits its first await inside kernelExecute.
        // At that point cell3 (CODE_CELL_3) and cell5 (CODE_CELL_5) are still in
        // 'queued' state and cancellable.
        const runAllP = dispatcher.runAll(RUN2_BUFNR);
        await dispatcher.cancelCell(RUN2_BUFNR, CODE_CELL_3);
        await runAllP;

        // cell1 and cell5 (CODE_CELL_5) executed; cell3 was skipped (cancelled)
        assertEquals(
          currentMk2.executeRequestCalls.length,
          2,
          `${CODE_CELL_5}: cell1 and cell5 execute; cell3 skipped (cancelled)`,
        );
        const ranMsgs = run2Host.cmdsMatching("Ran 2 code cells");
        assertEquals(
          ranMsgs.length > 0,
          true,
          "must show 'Ran 2 code cells'",
        );
        const cancelledMsgs = run2Host.cmdsMatching("1 cancelled");
        assertEquals(
          cancelledMsgs.length > 0,
          true,
          "must mention 1 cancelled cell",
        );
      },
    );
  },
);
