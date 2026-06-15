/**
 * BDD specs for startKernel, shutdownKernel, kernelStatus dispatcher.
 *
 * @spec-id europa.dispatcher.start-kernel
 * @spec-id europa.dispatcher.shutdown-kernel
 * @spec-id europa.dispatcher.kernel-status
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { buildDispatcher } from "../../../../denops/europa/main.ts";
import { mockVim } from "../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../fixtures/mock-host.ts";
import {
  makeMockKernel,
  type MockKernelHandle,
} from "../../../fixtures/mock-kernel.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import { ZmqKernelClient } from "../../../../denops/europa/kernel/zmq-client.ts";
import {
  makeMockZmqKernel,
  type MockZmqParams,
} from "../../../fixtures/mock-zmq-kernel.ts";

const FIXTURE_PATH = new URL(
  "../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

// ---------------------------------------------------------------------------
// startKernel dispatcher (europa.dispatcher.start-kernel)
// ---------------------------------------------------------------------------

// sanitizeResources/sanitizeOps: real WebSocket connections are cleaned up in
// afterEach via mk.close() — they remain open across the per-test sanitize window.
describe(
  "startKernel dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const KERNEL_BUFNR = 77;
    let kernelHost: MockHost;
    let currentMockKernel: MockKernelHandle | null = null;

    beforeEach(() => {
      kernelHost = mockVim();
      currentMockKernel = null;
    });

    afterEach(async () => {
      await currentMockKernel?.close();
      currentMockKernel = null;
    });

    function setKernelConfig(url: string, token: string): void {
      kernelHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      kernelHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it("(a) does not throw UnimplementedError for valid args", async () => {
      // Phase 2 had a stub throwing UnimplementedError — that must be gone.
      // startKernel catches internal failures via echomError and returns void.
      const dispatcher = buildDispatcher(kernelHost);
      let threwUnimplemented = false;
      try {
        await dispatcher.startKernel(KERNEL_BUFNR, "python3");
      } catch (e) {
        if ((e as Error).name === "UnimplementedError") {
          threwUnimplemented = true;
        }
      }
      assertEquals(
        threwUnimplemented,
        false,
        "startKernel must not throw UnimplementedError after Phase 3.2 wire-up",
      );
    });

    it(
      "(b) happy path emits no error when kernel is reachable",
      // Integration test: keeps a real WebSocket open until afterEach closes the server.
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMockKernel = makeMockKernel();
        setKernelConfig(currentMockKernel.url, currentMockKernel.token);

        const dispatcher = buildDispatcher(kernelHost);
        // Register the session so sessionStore.update actually persists kernelRuntime.
        await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
        kernelHost.calls = [];

        await dispatcher.startKernel(KERNEL_BUFNR, "python3");

        const errorCmds = kernelHost.cmdsMatching("echohl ErrorMsg");
        assertEquals(
          errorCmds.length,
          0,
          "no error message must be emitted when the kernel connects successfully",
        );
      },
    );

    it("(c) error path emits echomError and does not throw when kernel is unreachable", async () => {
      // Port 1 is not accessible — client.start() will throw CONNECTION_REFUSED.
      setKernelConfig("http://127.0.0.1:1", "sometoken");

      const dispatcher = buildDispatcher(kernelHost);
      await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
      kernelHost.calls = [];

      // Must not throw — errors are swallowed and routed to :messages.
      await dispatcher.startKernel(KERNEL_BUFNR, "python3");

      const errorCmds = kernelHost.cmdsMatching("echohl ErrorMsg");
      assertEquals(
        errorCmds.length > 0,
        true,
        "an error message must be emitted to :messages when the kernel is unreachable",
      );
      assertStringIncludes(
        String(errorCmds[0]?.args[0]),
        "startKernel failed",
        "the error message must include 'startKernel failed'",
      );
    });

    it(
      "(d) omitted kernelName uses g:europa_default_kernel",
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMockKernel = makeMockKernel();
        kernelHost.setEval(
          `get(g:, 'europa_default_kernel', "python3")`,
          "python3",
        );
        setKernelConfig(currentMockKernel.url, currentMockKernel.token);

        const dispatcher = buildDispatcher(kernelHost);
        await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
        kernelHost.calls = [];

        // No kernelName arg — dispatcher must fall back to g:europa_default_kernel.
        await dispatcher.startKernel(KERNEL_BUFNR);

        const errorCmds = kernelHost.cmdsMatching("echohl ErrorMsg");
        assertEquals(
          errorCmds.length,
          0,
          "omitted kernelName must use g:europa_default_kernel and succeed",
        );
      },
    );

    it("(e) negative bufnr throws EuropaKernelError INVALID_ARGS", async () => {
      const dispatcher = buildDispatcher(kernelHost);
      await assertRejects(
        () => dispatcher.startKernel(-1, "python3"),
        EuropaKernelError,
      );
    });

    it("(f) non-numeric bufnr throws EuropaKernelError INVALID_ARGS", async () => {
      const dispatcher = buildDispatcher(kernelHost);
      await assertRejects(
        () => dispatcher.startKernel("not-a-number", "python3"),
        EuropaKernelError,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// shutdownKernel dispatcher (europa.dispatcher.shutdown-kernel)
// ---------------------------------------------------------------------------

describe(
  "shutdownKernel dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const KERNEL_BUFNR = 78;
    let kernelHost: MockHost;
    let currentMockKernel: MockKernelHandle | null = null;

    beforeEach(() => {
      kernelHost = mockVim();
      currentMockKernel = null;
    });

    afterEach(async () => {
      await currentMockKernel?.close();
      currentMockKernel = null;
    });

    function setKernelConfig(url: string, token: string): void {
      kernelHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      kernelHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it("(a) is a no-op when no kernelRuntime is attached", async () => {
      const dispatcher = buildDispatcher(kernelHost);
      await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
      await dispatcher.shutdownKernel(KERNEL_BUFNR);
    });

    it("(b) shuts down an active kernel and issues DELETE /api/sessions", async () => {
      currentMockKernel = makeMockKernel();
      const mk = currentMockKernel;
      setKernelConfig(mk.url, mk.token);
      const dispatcher = buildDispatcher(kernelHost);
      await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(KERNEL_BUFNR, "python3");
      assertEquals(
        mk.deletedSessions.length,
        0,
        "no DELETE before shutdown",
      );
      await dispatcher.shutdownKernel(KERNEL_BUFNR);
      assertNotEquals(
        mk.deletedSessions.length,
        0,
        "DELETE must be issued after shutdownKernel",
      );
    });

    it("(c) idempotent: second shutdownKernel on same buffer is a no-op", async () => {
      currentMockKernel = makeMockKernel();
      const mk = currentMockKernel;
      setKernelConfig(mk.url, mk.token);
      const dispatcher = buildDispatcher(kernelHost);
      await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(KERNEL_BUFNR, "python3");
      await dispatcher.shutdownKernel(KERNEL_BUFNR);
      const deletionCountAfterFirst = mk.deletedSessions.length;
      await dispatcher.shutdownKernel(KERNEL_BUFNR);
      assertEquals(
        mk.deletedSessions.length,
        deletionCountAfterFirst,
        "second shutdownKernel must not issue additional DELETE",
      );
    });
  },
);

// ---------------------------------------------------------------------------
// kernelStatus dispatcher (europa.dispatcher.kernel-status)
// ---------------------------------------------------------------------------

describe(
  "kernelStatus dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const KERNEL_BUFNR = 79;
    let kernelHost: MockHost;
    let currentMockKernel: MockKernelHandle | null = null;

    beforeEach(() => {
      kernelHost = mockVim();
      currentMockKernel = null;
    });

    afterEach(async () => {
      await currentMockKernel?.close();
      currentMockKernel = null;
    });

    function setKernelConfig(url: string, token: string): void {
      kernelHost.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        url,
      );
      kernelHost.setEval(`get(g:, 'europa_jupyter_token', "")`, token);
      kernelHost.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
    }

    it("(a) returns {info: null, wsState: 'NONE'} when no kernel is attached", async () => {
      const dispatcher = buildDispatcher(kernelHost);
      await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);

      const report = await dispatcher.kernelStatus(KERNEL_BUFNR);

      assertEquals(
        report.info,
        null,
        "info must be null when no kernel attached",
      );
      assertEquals(
        report.wsState,
        "NONE",
        "wsState must be NONE when no kernel attached",
      );
      assertEquals(
        report.reconnect,
        undefined,
        "reconnect must be absent when no kernel",
      );
      assertEquals(
        report.uptimeSeconds,
        undefined,
        "uptimeSeconds must be absent when no kernel",
      );
      assertEquals(
        report.serverRefcount,
        undefined,
        "serverRefcount must be absent when no kernel",
      );
    });

    it(
      "(b) returns populated report with wsState='OPEN' when kernel is connected",
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMockKernel = makeMockKernel();
        setKernelConfig(currentMockKernel.url, currentMockKernel.token);

        const dispatcher = buildDispatcher(kernelHost);
        await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
        await dispatcher.startKernel(KERNEL_BUFNR, "python3");

        const report = await dispatcher.kernelStatus(KERNEL_BUFNR);

        assertNotEquals(
          report.info,
          null,
          "info must be populated after successful connection",
        );
        assertEquals(
          report.wsState,
          "OPEN",
          "wsState must be OPEN after successful connection",
        );
        assertEquals(
          report.reconnect,
          undefined,
          "reconnect must be absent when not reconnecting",
        );
        assertEquals(
          typeof report.serverRefcount,
          "number",
          "serverRefcount must be present after connection",
        );
      },
    );

    it(
      "(c) returns {info: null, wsState: 'NONE'} after kernel is shut down",
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMockKernel = makeMockKernel();
        setKernelConfig(currentMockKernel.url, currentMockKernel.token);

        const dispatcher = buildDispatcher(kernelHost);
        await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
        await dispatcher.startKernel(KERNEL_BUFNR, "python3");
        await dispatcher.shutdownKernel(KERNEL_BUFNR);

        const report = await dispatcher.kernelStatus(KERNEL_BUFNR);

        assertEquals(report.info, null, "info must be null after shutdown");
        assertEquals(
          report.wsState,
          "NONE",
          "wsState must be NONE after shutdown",
        );
      },
    );

    it("(d) does not throw when no session is open for the buffer", async () => {
      const dispatcher = buildDispatcher(kernelHost);

      const report = await dispatcher.kernelStatus(KERNEL_BUFNR);

      assertEquals(report.info, null, "info must be null when no session");
      assertEquals(
        report.wsState,
        "NONE",
        "wsState must be NONE when no session",
      );
    });

    it(
      "(e) serverRefcount is present and matches active pool entry",
      { sanitizeResources: false, sanitizeOps: false },
      async () => {
        currentMockKernel = makeMockKernel();
        setKernelConfig(currentMockKernel.url, currentMockKernel.token);

        const dispatcher = buildDispatcher(kernelHost);
        await dispatcher.open(KERNEL_BUFNR, FIXTURE_PATH);
        await dispatcher.startKernel(KERNEL_BUFNR, "python3");

        const report = await dispatcher.kernelStatus(KERNEL_BUFNR);

        assertEquals(
          report.serverRefcount,
          1,
          "serverRefcount must be 1 with one active connection",
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// attachKernel dispatcher (europa.dispatcher.attach-kernel)
// ---------------------------------------------------------------------------

describe(
  "attachKernel dispatcher",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const BUFNR = 91;
    const PARAMS: MockZmqParams = {
      shell_port: 60101,
      iopub_port: 60102,
      stdin_port: 60103,
      control_port: 60104,
      hb_port: 60105,
      ip: "127.0.0.1",
      key: "attach-key",
      signature_scheme: "hmac-sha256",
    };
    let host: MockHost;

    beforeEach(() => {
      host = mockVim();
    });

    async function writeConnFile(): Promise<string> {
      const path = await Deno.makeTempFile({ suffix: ".json" });
      await Deno.writeTextFile(
        path,
        JSON.stringify({ ...PARAMS, transport: "tcp", kernel_name: "python3" }),
      );
      return path;
    }

    function dispatcherWithMock(mockModule: unknown) {
      return buildDispatcher(host, {
        createZmqClient: (d, c, cf) =>
          new ZmqKernelClient(d, c, cf, {
            kernelInfoTimeoutMs: 2000,
            importZmq: () =>
              Promise.resolve(mockModule as typeof import("zeromq")),
          }),
      });
    }

    /** @spec-id europa.dispatcher.attach-kernel */
    it("attaches and commits a zmq kernelRuntime with a success notification", async () => {
      const path = await writeConnFile();
      const mock = makeMockZmqKernel(PARAMS);
      const dispatcher = dispatcherWithMock(mock.module);
      await dispatcher.open(BUFNR, FIXTURE_PATH);
      host.calls = [];

      await dispatcher.attachKernel(BUFNR, path);

      assertEquals(
        host.cmdsMatching("echohl ErrorMsg").length,
        0,
        "no error must be emitted on a successful attach",
      );
      assertEquals(
        host.cmdsMatching("Attached to kernel").length > 0,
        true,
        "a success notification must be emitted",
      );
      await dispatcher.shutdownKernel(BUFNR);
    });

    /** @spec-id europa.dispatcher.attach-kernel-reject-reattach */
    it("refuses re-attach when the buffer already has a kernel", async () => {
      const path = await writeConnFile();
      const mock = makeMockZmqKernel(PARAMS);
      const dispatcher = dispatcherWithMock(mock.module);
      await dispatcher.open(BUFNR, FIXTURE_PATH);
      await dispatcher.attachKernel(BUFNR, path); // first attach succeeds
      host.calls = [];

      await dispatcher.attachKernel(BUFNR, path); // second must be refused

      const errs = host.cmdsMatching("echohl ErrorMsg");
      assertEquals(errs.length > 0, true, "re-attach must emit an error");
      assertStringIncludes(String(errs[0]?.args[0]), "ALREADY_ATTACHED");
      await dispatcher.shutdownKernel(BUFNR);
    });

    it("rejects a missing session with INVALID_ARGS and no attach", async () => {
      const path = await writeConnFile();
      const mock = makeMockZmqKernel(PARAMS);
      const dispatcher = dispatcherWithMock(mock.module);
      // No dispatcher.open(): the buffer has no notebook session.
      await dispatcher.attachKernel(BUFNR, path);

      const errs = host.cmdsMatching("echohl ErrorMsg");
      assertEquals(errs.length > 0, true);
      assertStringIncludes(
        String(errs[0]?.args[0]),
        "no open notebook session",
      );
    });
  },
);
