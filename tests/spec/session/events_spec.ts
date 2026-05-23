/**
 * BDD specs for setupAutocmds — BufReadCmd, BufWriteCmd, BufUnload, BufWipeout,
 * VimLeavePre registration, and the `cleanup` / `atexit` dispatcher lifecycle.
 *
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 * @spec-id europa.session.events.bufunload-cleanup
 * @spec-id europa.session.events.bufwipeout-cleanup
 * @spec-id europa.session.events.vimleavepre-cleanup
 * @spec-id europa.dispatcher.cleanup-idempotent
 * @spec-id europa.dispatcher.cleanup-with-scratch
 * @spec-id europa.dispatcher.cleanup-with-kernel
 * @spec-id europa.dispatcher.atexit
 * @spec-id europa.session.events.jump-warned-reset
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater, assertNotEquals } from "@std/assert";
import { setupAutocmds } from "../../../denops/europa/session/events.ts";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import {
  makeMockKernel,
  type MockKernelHandle,
} from "../../fixtures/mock-kernel.ts";

const FIXTURE_PATH = new URL(
  "../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

describe("setupAutocmds", () => {
  it("registers BufReadCmd for *.ipynb", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufReadCmd");
    const hasBufRead = cmds.some((c) =>
      String(c.args[0]).includes("BufReadCmd") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufRead, true);
  });

  it("uses the europa_ipynb autocmd group", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const groupCmds = host.cmdsMatching("europa_ipynb");
    assertEquals(groupCmds.length > 0, true);
  });

  it("sets filetype=europa inside BufReadCmd so syntax is applied", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const hasSetFiletype = host.cmdsMatching("BufReadCmd").some((c) =>
      String(c.args[0]).includes("setfiletype europa")
    );
    assertEquals(hasSetFiletype, true);
  });
});

describe("setupAutocmds", () => {
  it("registers BufWriteCmd for *.ipynb", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufWriteCmd");
    const hasBufWrite = cmds.some((c) =>
      String(c.args[0]).includes("BufWriteCmd") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufWrite, true);
  });
});

describe("setupAutocmds", () => {
  it("registers BufUnload for *.ipynb cleanup", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufUnload");
    const hasBufUnload = cmds.some((c) =>
      String(c.args[0]).includes("BufUnload") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufUnload, true);
  });
});

// --- Phase 2 BufUnload cleanup path (europa.session.events.bufunload-cleanup) ---

describe("setupAutocmds — BufUnload cleanup path", () => {
  it("BufUnload autocmd string includes a cleanup call", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufUnload");
    const hasCleanup = cmds.some((c) => String(c.args[0]).includes("cleanup"));
    assertEquals(hasCleanup, true, "BufUnload autocmd must invoke cleanup");
  });
});

// --- Phase 3.1 BufWipeout cleanup registration (europa.session.events.bufwipeout-cleanup) ---

describe("setupAutocmds — BufWipeout registration (Phase 3.1)", () => {
  it("registers BufWipeout for *.ipynb in europa_ipynb group", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufWipeout");
    const hasBufWipeout = cmds.some((c) =>
      String(c.args[0]).includes("BufWipeout") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(
      hasBufWipeout,
      true,
      "BufWipeout *.ipynb must be registered in europa_ipynb group",
    );
  });

  it("BufWipeout autocmd string includes a cleanup call", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufWipeout");
    const hasCleanup = cmds.some((c) => String(c.args[0]).includes("cleanup"));
    assertEquals(
      hasCleanup,
      true,
      "BufWipeout autocmd must dispatch cleanup so scratch buffers are wiped",
    );
  });
});

// --- cleanup dispatcher idempotency (europa.dispatcher.cleanup-idempotent) ---

describe("cleanup dispatcher — idempotency", () => {
  let host: ReturnType<typeof mockVim>;

  beforeEach(() => {
    host = mockVim();
  });

  it("cleanup returns without error when no session is registered", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.cleanup(9999);
    } catch {
      threw = true;
    }
    assertEquals(threw, false, "cleanup must not throw for unknown bufnr");
  });

  it("cleanup is idempotent — second call with same bufnr is a no-op", async () => {
    const dispatcher = buildDispatcher(host);
    // First call: no session registered → should return cleanly
    await dispatcher.cleanup(9999);
    const callCountAfterFirst = host.calls.length;
    // Second call: still no session → must not make additional Vim calls
    await dispatcher.cleanup(9999);
    const additionalCalls = host.calls.length - callCountAfterFirst;
    assertEquals(
      additionalCalls,
      0,
      "Second cleanup on already-removed bufnr must not issue any Vim calls",
    );
  });
});

// --- cleanup with scratch buffers (europa.dispatcher.cleanup-with-scratch) ---

describe("cleanup dispatcher — scratch buffer wipeout", () => {
  let host: ReturnType<typeof mockVim>;

  beforeEach(() => {
    host = mockVim();
  });

  it("cleanup issues bwipeout! for each open scratch buffer", async () => {
    const dispatcher = buildDispatcher(host);
    const VIEWER_BUFNR = 5;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    const plan = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertNotEquals(
      plan,
      null,
      "lineToCellId must return a cell id for line 1",
    );
    await dispatcher.editCell(VIEWER_BUFNR, plan!);
    const bwipeoutsBefore = host.cmdsMatching("bwipeout!").length;
    await dispatcher.cleanup(VIEWER_BUFNR);
    assertGreater(
      host.cmdsMatching("bwipeout!").length,
      bwipeoutsBefore,
      "cleanup must issue bwipeout! for each open scratch buffer",
    );
    // Idempotency: second cleanup issues no additional bwipeout! calls
    const bwipeoutsAfterFirst = host.cmdsMatching("bwipeout!").length;
    await dispatcher.cleanup(VIEWER_BUFNR);
    assertEquals(
      host.cmdsMatching("bwipeout!").length,
      bwipeoutsAfterFirst,
      "Second cleanup must not issue additional bwipeout! calls",
    );
  });
});

// --- Phase 3.8 BufWinEnter resets europa_jump_warned (europa.session.events.jump-warned-reset) ---

describe("setupAutocmds — BufWinEnter jump-warned reset (Phase 3.8)", () => {
  it("BufWinEnter autocmd clears b:europa_jump_warned for the entering buffer", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufWinEnter");
    const resetsFlag = cmds.some((c) =>
      String(c.args[0]).includes("BufWinEnter") &&
      String(c.args[0]).includes("let b:europa_jump_warned = 0")
    );
    assertEquals(
      resetsFlag,
      true,
      "BufWinEnter must reset b:europa_jump_warned so a hidden→visible " +
        "transition re-enables the next :EuropaJumpError warning (FR-019)",
    );
  });
});

// --- Phase 3.2 VimLeavePre registration (europa.session.events.vimleavepre-cleanup) ---

describe("setupAutocmds — VimLeavePre registration (Phase 3.2)", () => {
  it("registers VimLeavePre with wildcard pattern in europa_ipynb group", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("VimLeavePre");
    const hasVimLeavePre = cmds.some((c) =>
      String(c.args[0]).includes("VimLeavePre *")
    );
    assertEquals(
      hasVimLeavePre,
      true,
      "VimLeavePre must use * pattern so atexit fires on exit from any buffer",
    );
  });

  it("VimLeavePre autocmd invokes atexit", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("VimLeavePre");
    const hasAtexit = cmds.some((c) => String(c.args[0]).includes("atexit"));
    assertEquals(
      hasAtexit,
      true,
      "VimLeavePre autocmd must dispatch atexit so kernels are cleaned up on exit",
    );
  });
});

// --- Phase 3.2 cleanup with kernelRuntime (europa.dispatcher.cleanup-with-kernel) ---

describe(
  "cleanup dispatcher — kernelRuntime shutdown (Phase 3.2)",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let mk: MockKernelHandle | null = null;

    afterEach(async () => {
      await mk?.close();
      mk = null;
    });

    it("(a) cleanup is still idempotent when kernelRuntime is absent", async () => {
      const host = mockVim();
      const dispatcher = buildDispatcher(host);
      const VIEWER_BUFNR = 8;
      await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
      await dispatcher.cleanup(VIEWER_BUFNR);
      await dispatcher.cleanup(VIEWER_BUFNR); // second call: no-op
    });

    it("(b) cleanup issues DELETE when an active kernel is attached", async () => {
      mk = makeMockKernel();
      const host = mockVim();
      host.setEval(`get(g:, 'europa_use_subprocess', v:true)`, false);
      host.setEval(
        `get(g:, 'europa_jupyter_url', "http://localhost:8888")`,
        mk.url,
      );
      host.setEval(`get(g:, 'europa_jupyter_token', "")`, mk.token);
      host.setEval(
        `get(g:, 'europa_jupyter_ws_subprotocol', "default")`,
        "default",
      );
      const dispatcher = buildDispatcher(host);
      const VIEWER_BUFNR = 9;
      await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
      await dispatcher.startKernel(VIEWER_BUFNR, "python3");
      assertEquals(mk.deletedSessions.length, 0, "no DELETE before cleanup");
      await dispatcher.cleanup(VIEWER_BUFNR);
      assertNotEquals(
        mk.deletedSessions.length,
        0,
        "cleanup must issue DELETE /api/sessions when kernelRuntime is active",
      );
    });
  },
);

// --- Phase 3.2 atexit dispatcher (europa.dispatcher.atexit) ---

describe("atexit dispatcher — all kernels shutdown", () => {
  it("atexit completes without error when no kernels are active", async () => {
    const host = mockVim();
    const dispatcher = buildDispatcher(host);
    await dispatcher.atexit();
  });

  it("atexit is a no-op on sessions without kernelRuntime", async () => {
    const host = mockVim();
    const dispatcher = buildDispatcher(host);
    const VIEWER1 = 11;
    const VIEWER2 = 12;
    await dispatcher.open(VIEWER1, FIXTURE_PATH);
    await dispatcher.open(VIEWER2, FIXTURE_PATH);
    // No kernelRuntimes registered — atexit must complete without error
    await dispatcher.atexit();
  });
});
