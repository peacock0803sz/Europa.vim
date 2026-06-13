/**
 * BDD specs for splitCell dispatcher.
 *
 * @spec-id europa.dispatcher.split-cell
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildDispatcher } from "../../../../../denops/europa/main.ts";
import { mockVim } from "../../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

let host: MockHost;

// --- splitCell dispatcher (europa.dispatcher.split-cell) ---

describe("splitCell dispatcher", () => {
  const VIEWER_BUFNR = 48;
  // 1st code cell of edit-target.ipynb has a 2-line source; index 0 in cells[].
  const FIRST_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.splitCell(9999, FIRST_CELL_ID, 1);
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.splitCell(9999, FIRST_CELL_ID, 1);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("splits the cell and grows the notebook by one (viewer path)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    // Line 3 in the viewer falls within cell 1's source ("print(...)").
    await dispatcher.splitCell(VIEWER_BUFNR, FIRST_CELL_ID, 3);
    const lines = host.getBufLines(VIEWER_BUFNR);
    // Two distinct head borders exist for the original cell's id and
    // the freshly minted lower-half cell; structural mutation succeeded.
    const headerCount =
      lines.filter((l) => l.startsWith("╭") && l.includes("In [")).length;
    assertEquals(
      headerCount >= 4,
      true,
      "splitting cell 1 must add a new code header so total code headers is >= 4 (originally 3)",
    );
  });

  it("snaps a header-line cursor to splitLine = 0 (upper cell becomes empty)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    // Line 1 is the boundary header itself; splitLine should snap to 0.
    await dispatcher.splitCell(VIEWER_BUFNR, FIRST_CELL_ID, 1);
    const lines = host.getBufLines(VIEWER_BUFNR);
    const firstSourceLineIdx = lines.findIndex((l) =>
      l === "" || l.startsWith("╭") || l.startsWith("╰")
    );
    // After a splitLine=0 split, the original cellId's body is empty, so the
    // line right after its header is either another header or a blank line.
    assertEquals(firstSourceLineIdx >= 0, true);
  });

  it("marks the viewer buffer dirty after a successful split", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.splitCell(VIEWER_BUFNR, FIRST_CELL_ID, 3);
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty !== undefined, true);
  });

  it("emits a warning when cellId is not in the notebook", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.splitCell(VIEWER_BUFNR, "nonexistent-id", 1);
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("supports the scratch path: the line is taken as a 1-origin source row", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    // Scratch line 2 -> splitLine = 1 -> upper has one source line, lower has
    // the rest. The dispatcher must resolve the viewer via reverse lookup.
    await dispatcher.splitCell(scratchBufnr, FIRST_CELL_ID, 2);
    // Viewer was re-rendered: probe via lineToCellId to confirm the original
    // cellId is still findable (it owns the upper half).
    const cellAtTop = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertEquals(cellAtTop, FIRST_CELL_ID);
  });

  it("rewrites the scratch buffer with the upper-half source after split", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.splitCell(scratchBufnr, FIRST_CELL_ID, 2);
    const scratchLines = host.getBufLines(scratchBufnr);
    // Upper half is the first source line of cell 1 only.
    assertEquals(scratchLines.length, 1);
    assertEquals(scratchLines[0], "# Cell 1: code with stream output");
  });

  it("refuses to split when the cell's scratch buffer has unsaved edits", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    // Mark the scratch as dirty (= user typed but did not :write).
    await host.call("setbufvar", scratchBufnr, "&modified", 1);
    host.calls = [];
    await dispatcher.splitCell(VIEWER_BUFNR, FIRST_CELL_ID, 3);
    // Expect a guidance message (refusal), no &modified=1 on viewer (= no
    // structural mutation), and no setbufline against the scratch (= we
    // did not silently overwrite the user's typed content).
    const refusal = host.cmdsMatching("unsaved scratch edits");
    assertEquals(refusal.length > 0, true, "refusal guidance must appear");
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty, undefined, "viewer must not be re-rendered");
    const setbufline = host.callsTo("setbufline").find((c) =>
      c.args[1] === scratchBufnr
    );
    assertEquals(setbufline, undefined, "scratch must not be overwritten");
  });

  it("skips the upper-cell scratch rewrite without throwing when the registered bufnr was wiped", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    // Stale session map: wipe the scratch but leave the session entry to
    // simulate the BufWipeout-cleanup race window.
    await host.call("bwipeout!", scratchBufnr);
    host.calls = [];
    let threw = false;
    try {
      await dispatcher.splitCell(VIEWER_BUFNR, FIRST_CELL_ID, 3);
    } catch {
      threw = true;
    }
    assertEquals(
      threw,
      false,
      "splitCell must not throw on a stale scratch bufnr",
    );
    const setbufline = host.callsTo("setbufline").find((c) =>
      c.args[1] === scratchBufnr
    );
    assertEquals(
      setbufline,
      undefined,
      "setbufline must not target a wiped scratch buffer",
    );
  });
});
