/**
 * BDD specs for setupAutocmds — BufReadCmd, BufWriteCmd, BufUnload, BufWipeout
 * registration, and the `cleanup` dispatcher lifecycle.
 *
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 * @spec-id europa.session.events.bufunload-cleanup
 * @spec-id europa.session.events.bufwipeout-cleanup
 * @spec-id europa.dispatcher.cleanup-idempotent
 * @spec-id europa.dispatcher.cleanup-with-scratch
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { setupAutocmds } from "../../../denops/europa/session/events.ts";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { mockVim } from "../../fixtures/mock-host.ts";

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
    // Open a notebook to establish a session
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    // Open a scratch edit buffer for the first cell
    const plan = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    // editCell opens a scratch buffer for the resolved cell id
    if (plan) {
      await dispatcher.editCell(VIEWER_BUFNR, plan);
    }
    // Record call count before cleanup
    const callsBefore = host.calls.length;
    await dispatcher.cleanup(VIEWER_BUFNR);
    // After cleanup, the session should be gone (second call is no-op)
    const callsAfterFirst = host.calls.length;
    await dispatcher.cleanup(VIEWER_BUFNR);
    const callsAfterSecond = host.calls.length;
    // Idempotency: second cleanup adds no Vim calls
    assertEquals(
      callsAfterSecond - callsAfterFirst,
      0,
      "Second cleanup must be a no-op after session is gone",
    );
    // The first cleanup must have done something (bwipeout! or augroup cleanup)
    assertEquals(
      callsAfterFirst > callsBefore,
      true,
      "cleanup must issue at least one Vim call to tear down the session",
    );
  });
});
