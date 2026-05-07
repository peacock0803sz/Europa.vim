/**
 * BDD specs for interruptKernel and restartKernel dispatcher.
 *
 * @spec-id europa.dispatcher.interrupt-kernel
 * @spec-id europa.kernel.interrupt.idle-no-op
 * @spec-id europa.kernel.interrupt.reconnect-mid
 * @spec-id europa.dispatcher.restart-kernel
 * @spec-id europa.kernel.restart.exec-count-reset
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

// ---------------------------------------------------------------------------
// interruptKernel dispatcher (T035)
// ---------------------------------------------------------------------------

describe(
  "interruptKernel dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const INT_BUFNR = 90;
    let intHost: MockHost;
    let currentMkInt: MockKernelHandle | null = null;

    beforeEach(() => {
      intHost = mockVim();
      currentMkInt = null;
    });

    afterEach(async () => {
      await currentMkInt?.close();
      currentMkInt = null;
    });

    function setIntConfig(url: string, token: string): void {
      intHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      intHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      intHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      intHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    async function startKernelForInt(
      dispatcher: ReturnType<typeof buildDispatcher>,
    ): Promise<void> {
      await dispatcher.open(INT_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(INT_BUFNR, "python3");
      intHost.calls = [];
    }

    it(
      "(a) idle kernel → 'Kernel is idle' info + REST sent + 'Interrupt sent'",
      async () => {
        currentMkInt = makeMockKernel();
        setIntConfig(currentMkInt.url, currentMkInt.token);
        const dispatcher = buildDispatcher(intHost);
        await startKernelForInt(dispatcher);

        await dispatcher.interruptKernel(INT_BUFNR);

        // REST interrupt must be sent even in idle state (FR-010)
        assertEquals(
          currentMkInt.interruptCallTimestamps.length,
          1,
          "exactly 1 REST interrupt call expected",
        );
        const idleMsgs = intHost.cmdsMatching("Kernel is idle");
        assertEquals(
          idleMsgs.length > 0,
          true,
          "must show 'Kernel is idle' info message",
        );
        const sentMsgs = intHost.cmdsMatching("Interrupt sent");
        assertEquals(
          sentMsgs.length > 0,
          true,
          "must show 'Interrupt sent' after successful REST call",
        );
      },
    );

    it(
      "(b) no kernel attached → 'No kernel attached' message, no REST",
      async () => {
        const dispatcher = buildDispatcher(intHost);
        await dispatcher.open(INT_BUFNR, FIXTURE_PATH);
        intHost.calls = [];

        await dispatcher.interruptKernel(INT_BUFNR);

        const msgs = intHost.cmdsMatching("No kernel attached");
        assertEquals(
          msgs.length > 0,
          true,
          "must show 'No kernel attached'",
        );
      },
    );

    it(
      "(c) reconnect in progress (FR-011) → 'Cannot interrupt during reconnect', no REST",
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMkInt = makeMockKernel();
        // Long reconnect interval so the kernel stays in reconnect state during the test
        intHost.setEval(
          `get(g:, 'europa_ws_reconnect_initial_interval_ms', 1000)`,
          30000,
        );
        setIntConfig(currentMkInt.url, currentMkInt.token);
        const dispatcher = buildDispatcher(intHost);
        await startKernelForInt(dispatcher);

        // Force WS disconnect → reconnect loop starts, kr.reconnect is set immediately
        currentMkInt.forceWsClose();

        // Wait for the close event to propagate and the reconnect loop to set
        // runtime.reconnect. A fixed sleep is flaky on slow CI runners.
        const reconnectDeadline = Date.now() + 2000;
        let reconnectStarted = false;
        while (Date.now() < reconnectDeadline) {
          const report = await dispatcher.kernelStatus(INT_BUFNR);
          if (report.reconnect) {
            reconnectStarted = true;
            break;
          }
          await new Promise<void>((r) => setTimeout(r, 5));
        }
        assertEquals(
          reconnectStarted,
          true,
          "reconnect loop did not start within 2s",
        );

        await dispatcher.interruptKernel(INT_BUFNR);

        // REST interrupt must NOT be sent during reconnect (FR-011)
        assertEquals(
          currentMkInt.interruptCallTimestamps.length,
          0,
          "no REST interrupt call expected during reconnect",
        );
        const reconnectMsgs = intHost.cmdsMatching(
          "Cannot interrupt during reconnect",
        );
        assertEquals(
          reconnectMsgs.length > 0,
          true,
          "must show 'Cannot interrupt during reconnect' message",
        );
      },
    );
  },
);

// restartKernel dispatcher (T043)
// ---------------------------------------------------------------------------

describe(
  "restartKernel dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const RST_BUFNR = 92;
    let rstHost: MockHost;
    let currentMkRst: MockKernelHandle | null = null;

    beforeEach(() => {
      rstHost = mockVim();
      currentMkRst = null;
    });

    afterEach(async () => {
      await currentMkRst?.close();
      currentMkRst = null;
    });

    function setRstConfig(url: string, token: string): void {
      rstHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      rstHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      rstHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      rstHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    async function startKernelForRst(
      dispatcher: ReturnType<typeof buildDispatcher>,
    ): Promise<void> {
      await dispatcher.open(RST_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(RST_BUFNR, "python3");
      rstHost.calls = [];
    }

    it(
      "(a) happy path: REST restart sent, 'Kernel restarted' message, execution_count cleared",
      async () => {
        currentMkRst = makeMockKernel();
        setRstConfig(currentMkRst.url, currentMkRst.token);
        const dispatcher = buildDispatcher(rstHost);
        await startKernelForRst(dispatcher);

        await dispatcher.restartKernel(RST_BUFNR);

        assertEquals(
          currentMkRst.restartCallCount,
          1,
          "exactly 1 REST restart call",
        );
        const restartedMsgs = rstHost.cmdsMatching("Kernel restarted");
        assertEquals(
          restartedMsgs.length > 0,
          true,
          "must show 'Kernel restarted' message",
        );
        // Verify execution_count cleared (spec: europa.kernel.restart.exec-count-reset)
        // startKernelForRst() clears rstHost.calls, so all setbufline calls here are
        // from the re-render triggered by restartKernel().
        const rerenderedLines = rstHost.callsTo("setbufline")
          .filter((c) => c.args[1] === RST_BUFNR)
          .flatMap((c) => c.args[3] as string[]);
        assertEquals(
          rerenderedLines.some((l) => /In \[\d+\]/.test(l)),
          false,
          "no 'In [N]' lines after restart — execution_count must be null",
        );
        assertEquals(
          rerenderedLines.some((l) => l.includes("In [ ]")),
          true,
          "'In [ ]' present after restart confirms cleared execution_count",
        );
      },
    );

    it(
      "(b) no kernel attached → 'No kernel attached' message",
      async () => {
        const dispatcher = buildDispatcher(rstHost);
        await dispatcher.open(RST_BUFNR, FIXTURE_PATH);
        rstHost.calls = [];

        await dispatcher.restartKernel(RST_BUFNR);

        const msgs = rstHost.cmdsMatching("No kernel attached");
        assertEquals(
          msgs.length > 0,
          true,
          "must show 'No kernel attached'",
        );
      },
    );

    it(
      "(c) restart-during-busy: aborts in-flight execute, restart completes",
      async () => {
        // Use a slow execute script (5s delay) so the runCell stays in-flight
        // when restartKernel is called concurrently.
        currentMkRst = makeMockKernel({ executeReplyDelayMs: 5000 });
        setRstConfig(currentMkRst.url, currentMkRst.token);
        const dispatcher = buildDispatcher(rstHost);
        await startKernelForRst(dispatcher);

        // Start a runCell that will block for 5 seconds
        const FIRST_CELL = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
        const runCellPromise = dispatcher.runCell(RST_BUFNR, FIRST_CELL)
          .catch(() => {});

        // Give the execute a moment to start and enter busy state
        await new Promise<void>((r) => setTimeout(r, 20));

        // Now restart — this should abort the in-flight execute and complete
        await dispatcher.restartKernel(RST_BUFNR);

        // Wait for runCell to settle (it should have been aborted)
        await runCellPromise;

        assertEquals(
          currentMkRst.restartCallCount,
          1,
          "exactly 1 REST restart call",
        );
        const restartedMsgs = rstHost.cmdsMatching("Kernel restarted");
        assertEquals(
          restartedMsgs.length > 0,
          true,
          "must show 'Kernel restarted' after busy restart",
        );
      },
    );

    it(
      "(d) 5xx REST response → 'Kernel restart failed' message, no crash",
      async () => {
        currentMkRst = makeMockKernel({ restartReplyStatus: 500 });
        setRstConfig(currentMkRst.url, currentMkRst.token);
        const dispatcher = buildDispatcher(rstHost);
        await startKernelForRst(dispatcher);

        await dispatcher.restartKernel(RST_BUFNR);

        const failedMsgs = rstHost.cmdsMatching("Kernel restart failed");
        assertEquals(
          failedMsgs.length > 0,
          true,
          "must show 'Kernel restart failed' on 5xx",
        );
      },
    );
  },
);
