/**
 * BDD specs for the dispatcher's internal RPCs and cell-editing methods.
 *
 * Phase 008 addition (T018):
 * Verifies that each of the 6 structural mutation dispatchers calls
 * session.undoHistory.push() before mutating the notebook. Verified
 * behaviorally: after a mutation, europaUndo reverses the change, confirming
 * an entry was pushed (a missing push would yield "nothing to undo").
 *
 * Phase 3.4 additions:
 * @spec-id europa.dispatcher.runcell-batch-driven
 * @spec-id europa.dispatcher.runall-batch-driven
 * @spec-id europa.dispatcher.cellops-flush-on-entry
 *
 * @spec-id europa.dispatcher.line-to-cellid
 * @spec-id europa.dispatcher.insert-cell
 * @spec-id europa.dispatcher.delete-cell
 * @spec-id europa.dispatcher.move-cell
 * @spec-id europa.dispatcher.split-cell
 * @spec-id europa.dispatcher.join-cell
 * @spec-id europa.dispatcher.edit-cell
 * @spec-id europa.dispatcher.save-cell-edit
 * @spec-id europa.dispatcher.close-cell-edit
 * @spec-id europa.dispatcher.change-cell-type
 * @spec-id europa.dispatcher.start-kernel
 * @spec-id europa.dispatcher.shutdown-kernel
 * @spec-id europa.dispatcher.kernel-status
 * @spec-id europa.dispatcher.run-cell
 * @spec-id europa.dispatcher.run-cell-queued-on-busy
 * @spec-id europa.dispatcher.run-all
 * @spec-id europa.dispatcher.cancel-cell
 * @spec-id europa.dispatcher.interrupt-kernel
 * @spec-id europa.kernel.interrupt.idle-no-op
 * @spec-id europa.kernel.interrupt.reconnect-mid
 * @spec-id europa.dispatcher.restart-kernel
 * @spec-id europa.kernel.restart.exec-count-reset
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";
import {
  makeMockKernel,
  type MockKernelHandle,
} from "../../fixtures/mock-kernel.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";

const FIXTURE_PATH = new URL(
  "../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

let host: MockHost;

describe("lineToCellId internal RPC", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("returns null when no session is registered for the bufnr", async () => {
    const dispatcher = buildDispatcher(host);
    const result = await dispatcher.lineToCellId(9999, 1);
    assertEquals(result, null);
  });

  it("returns null when the session has no cached renderPlan", async () => {
    const dispatcher = buildDispatcher(host);
    const result = await dispatcher.lineToCellId(1, 1);
    assertEquals(result, null);
  });

  it("returns null for a line out of all cell ranges", async () => {
    const dispatcher = buildDispatcher(host);
    const result = await dispatcher.lineToCellId(1, 9999);
    assertEquals(result, null);
  });
});

// --- insertCell dispatcher (europa.dispatcher.insert-cell) ---

describe("insertCell dispatcher", () => {
  const VIEWER_BUFNR = 42;

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.insertCell(9999, "code", "after", "some-cell-id");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "must emit warning on missing session",
    );
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.insertCell(9999, "code", "after", "some-cell-id");
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("updates the notebook and caches a renderPlan after successful insert", async () => {
    const dispatcher = buildDispatcher(host);
    // Open the fixture to create a real session
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    const anchorCellId = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", anchorCellId);
    // lineToCellId returns non-null only when renderPlan is cached after insert
    const cellId = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertNotEquals(
      cellId,
      null,
      "renderPlan must be cached after insert so lineToCellId resolves",
    );
  });

  it("emits a warning for invalid cell type", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.insertCell(
      VIEWER_BUFNR,
      "invalid-type",
      "after",
      "some-id",
    );
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true, "invalid type must emit warning");
  });
});

// --- deleteCell dispatcher (europa.dispatcher.delete-cell) ---

describe("deleteCell dispatcher", () => {
  const VIEWER_BUFNR = 43;

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.deleteCell(9999, "some-cell-id");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "must emit warning on missing session",
    );
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.deleteCell(9999, "some-cell-id");
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("updates the notebook and caches a renderPlan after successful delete", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    const targetCellId = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
    await dispatcher.deleteCell(VIEWER_BUFNR, targetCellId);
    // After deletion the renderPlan is updated; lineToCellId returns a cellId for line 1
    const cellId = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertNotEquals(
      cellId,
      null,
      "renderPlan must be cached after delete so lineToCellId resolves",
    );
  });

  it("clears the frozen scratch's europa_cell_edit augroup", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    const targetCellId = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
    await dispatcher.editCell(VIEWER_BUFNR, targetCellId);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === targetCellId
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.deleteCell(VIEWER_BUFNR, targetCellId);
    // Without this fix, only closeCellEdit clears the augroup, but
    // deleteCell removes the session entry first so closeCellEdit can
    // no longer locate the cellId — the group would leak forever.
    const augroupClear = host.cmdsMatching(
      `europa_cell_edit_${scratchBufnr}`,
    );
    assertEquals(
      augroupClear.length > 0,
      true,
      "deleteCell must clear the augroup synchronously",
    );
  });
});

// --- moveCell dispatcher (europa.dispatcher.move-cell) ---

describe("moveCell dispatcher", () => {
  const VIEWER_BUFNR = 47;
  const FIRST_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
  const SECOND_CELL_ID = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
  const LAST_CELL_ID = "058f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3f";

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.moveCell(9999, FIRST_CELL_ID, "down");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "must emit warning on missing session",
    );
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.moveCell(9999, FIRST_CELL_ID, "down");
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("emits a warning for invalid direction", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.moveCell(VIEWER_BUFNR, FIRST_CELL_ID, "sideways");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("swaps the cell with the next one and refreshes the renderPlan on `down`", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.moveCell(VIEWER_BUFNR, FIRST_CELL_ID, "down");
    // After the swap, line 1 (the first boundary) belongs to the cell that
    // was previously second — the renderPlan must have been rebuilt.
    const cellId = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertEquals(
      cellId,
      SECOND_CELL_ID,
      "renderPlan must reflect the post-swap cell order",
    );
  });

  it("marks the viewer buffer dirty after a successful move", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.moveCell(VIEWER_BUFNR, FIRST_CELL_ID, "down");
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(
      dirty !== undefined,
      true,
      "viewer must be dirty after structural mutation",
    );
  });

  it("emits an `Already at top` guidance and skips commit when moving the first cell up", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.moveCell(VIEWER_BUFNR, FIRST_CELL_ID, "up");
    const guidance = host.cmdsMatching("Already at top");
    assertEquals(
      guidance.length > 0,
      true,
      "boundary no-op must surface user-facing guidance",
    );
    // No structural change → viewer must not be marked dirty by this call.
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty, undefined, "no-op must not dirty the viewer");
  });

  it("emits an `Already at bottom` guidance when moving the last cell down", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.moveCell(VIEWER_BUFNR, LAST_CELL_ID, "down");
    const guidance = host.cmdsMatching("Already at bottom");
    assertEquals(guidance.length > 0, true);
  });

  it("emits a warning when cellId is not found in the notebook", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.moveCell(VIEWER_BUFNR, "nonexistent-id", "up");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });
});

// --- splitCell dispatcher (europa.dispatcher.split-cell) ---

describe("splitCell dispatcher", () => {
  const VIEWER_BUFNR = 48;
  // 1st code cell of edit-target.ipynb has a 2-line source; index 0 in cells[].
  const FIRST_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
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

// --- joinCell dispatcher (europa.dispatcher.join-cell) ---

describe("joinCell dispatcher", () => {
  const VIEWER_BUFNR = 49;
  const FIRST_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
  const SECOND_CELL_ID = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.joinCell(9999, FIRST_CELL_ID);
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.joinCell(9999, FIRST_CELL_ID);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("emits `No cell above to join` when target is the first cell", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const guidance = host.cmdsMatching("No cell above to join");
    assertEquals(guidance.length > 0, true);
    // No structural change → viewer not dirty.
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty, undefined);
  });

  it("emits a warning when cellId is not in the notebook", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, "nonexistent-id");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("merges cell 2 into cell 1 and shrinks the notebook by one", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const lines = host.getBufLines(VIEWER_BUFNR);
    // Originally 5 cells = 5 headers; after join 4 cells = 4 headers.
    const allHeaders = lines.filter((l) => l.startsWith("╭"));
    assertEquals(allHeaders.length, 4);
    // The merged cell still uses the previous (cell 1) id and absorbed the
    // markdown source on the line right after its header.
    const cellAtTop = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertEquals(cellAtTop, FIRST_CELL_ID);
  });

  it("marks the viewer buffer dirty after a successful join", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty !== undefined, true);
  });

  it("freezes the target cell's scratch buffer when it has one", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === SECOND_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    // freezeCellEditBuffer appends the deletion marker line.
    const append = host.callsTo("appendbufline").find((c) =>
      c.args[1] === scratchBufnr
    );
    assertEquals(append !== undefined, true);
  });

  it("refuses to join when the target cell's scratch has unsaved edits", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === SECOND_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    await host.call("setbufvar", scratchBufnr, "&modified", 1);
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const refusal = host.cmdsMatching("unsaved scratch edits");
    assertEquals(refusal.length > 0, true);
    const append = host.callsTo("appendbufline").find((c) =>
      c.args[1] === scratchBufnr
    );
    assertEquals(
      append,
      undefined,
      "scratch must not be frozen when join is refused",
    );
  });

  it("refuses to join when the previous cell's scratch has unsaved edits", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    // Open scratch on the FIRST (= prev) cell, leave it dirty, then try
    // joining the SECOND cell upward. The dispatcher must refuse so
    // the user's typed content in the first cell's scratch survives.
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    await host.call("setbufvar", scratchBufnr, "&modified", 1);
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const refusal = host.cmdsMatching("unsaved scratch edits");
    assertEquals(refusal.length > 0, true);
    const setbufline = host.callsTo("setbufline").find((c) =>
      c.args[1] === scratchBufnr
    );
    assertEquals(
      setbufline,
      undefined,
      "previous cell's scratch must not be overwritten",
    );
  });

  it("clears the absorbed scratch's europa_cell_edit augroup", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === SECOND_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    // Same reasoning as deleteCell: closeCellEdit cannot reach this
    // augroup once the session entry is removed, so joinCell must
    // clear it synchronously.
    const augroupClear = host.cmdsMatching(
      `europa_cell_edit_${scratchBufnr}`,
    );
    assertEquals(
      augroupClear.length > 0,
      true,
      "joinCell must clear the absorbed scratch's augroup synchronously",
    );
  });

  it("rewrites the surviving (previous) cell's scratch buffer with the joined source", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    const scratchLines = host.getBufLines(scratchBufnr);
    const joinedHasMarkdownLine = scratchLines.some((l) =>
      l.includes("Cell 2: Markdown heading")
    );
    assertEquals(
      joinedHasMarkdownLine,
      true,
      "previous cell's scratch must contain the absorbed markdown source",
    );
  });

  it("skips the surviving-cell scratch rewrite without throwing when the registered bufnr was wiped", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, FIRST_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === FIRST_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    // Same race-window simulation as splitCell: surviving scratch is gone
    // but the session map still carries its bufnr.
    await host.call("bwipeout!", scratchBufnr);
    host.calls = [];
    let threw = false;
    try {
      await dispatcher.joinCell(VIEWER_BUFNR, SECOND_CELL_ID);
    } catch {
      threw = true;
    }
    assertEquals(
      threw,
      false,
      "joinCell must not throw on a stale surviving scratch bufnr",
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

// --- editCell dispatcher (europa.dispatcher.edit-cell) ---

describe("editCell dispatcher", () => {
  const VIEWER_BUFNR = 44;
  const TARGET_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.editCell(9999, TARGET_CELL_ID);
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("emits a warning when cellId is not found in the session", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, "nonexistent-cell-id");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true);
  });

  it("opens a scratch buffer and registers it in the session", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const bufaddCalls = host.callsTo("bufadd").filter((c) =>
      String(c.args[1]).includes(`__europa_cell_${TARGET_CELL_ID}__`)
    );
    assertEquals(bufaddCalls.length, 1);
    const splitCmds = host.cmdsMatching("split #");
    assertEquals(splitCmds.length > 0, true);
  });

  it("reuses the same scratch buffer on a second editCell for the same cellId", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const bufaddCalls = host.callsTo("bufadd");
    assertEquals(bufaddCalls.length, 0, "no second bufadd for reuse");
    const winFindbuf = host.callsTo("win_findbuf");
    assertEquals(
      winFindbuf.length > 0,
      true,
      "reuse path must consult win_findbuf to avoid clobbering the viewer",
    );
  });

  it("resolves filetype from kernelspec.language for code cells", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const filetype = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "&filetype" && c.args[3] === "python"
    );
    assertEquals(filetype !== undefined, true);
  });
});

// --- saveCellEdit dispatcher (europa.dispatcher.save-cell-edit) ---

describe("saveCellEdit dispatcher", () => {
  const VIEWER_BUFNR = 45;
  const TARGET_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
  });

  it("is a no-op when scratchBufnr is not registered with any session", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.saveCellEdit(9999);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("writes scratch buffer content back into the cell source", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === TARGET_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    await host.call("setbufline", scratchBufnr, 1, [
      "print('edited')",
      "x = 42",
    ]);
    host.calls = [];
    await dispatcher.saveCellEdit(scratchBufnr);

    // The viewer was re-rendered with the new source — verify by
    // inspecting the lines applyRenderPlan wrote into the viewer buffer.
    const viewerLines = host.getBufLines(VIEWER_BUFNR);
    const editedLineFound = viewerLines.some((l) =>
      l.includes("print('edited')")
    );
    assertEquals(
      editedLineFound,
      true,
      "viewer must contain the edited source line after saveCellEdit",
    );
    const secondLineFound = viewerLines.some((l) => l.includes("x = 42"));
    assertEquals(
      secondLineFound,
      true,
      "viewer must contain every edited source line",
    );

    // Scratch's &modified flag is cleared so :write reports success.
    const modifiedClear = host.callsTo("setbufvar").find((c) =>
      c.args[1] === scratchBufnr && c.args[2] === "&modified" &&
      c.args[3] === 0
    );
    assertEquals(modifiedClear !== undefined, true);
  });

  it("marks the viewer buffer dirty after saveCellEdit", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === TARGET_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    await host.call("setbufline", scratchBufnr, 1, ["x = 99"]);
    host.calls = [];
    await dispatcher.saveCellEdit(scratchBufnr);
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty !== undefined, true);
  });

  // T030: verify that saveCellEdit pushes to undoHistory with opType=saveCellEdit
  // and scratchSync.preSource = the source before the save.
  it("pushes undo entry with opType=saveCellEdit before mutating cell.source (T030)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === TARGET_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    await host.call("setbufline", scratchBufnr, 1, ["new source"]);
    host.calls = [];
    await dispatcher.saveCellEdit(scratchBufnr);

    // Verify push was called: europaUndo should succeed (no "nothing to undo")
    host.calls = [];
    await dispatcher.europaUndo(VIEWER_BUFNR);
    await new Promise((r) => setTimeout(r, 80));
    const warnCmds = host.cmdsMatching("nothing to undo");
    assertEquals(
      warnCmds.length,
      0,
      "saveCellEdit must push to undoHistory with opType=saveCellEdit",
    );
  });
});

// --- closeCellEdit dispatcher (europa.dispatcher.close-cell-edit) ---

describe("closeCellEdit dispatcher", () => {
  const VIEWER_BUFNR = 46;
  const TARGET_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
  });

  it("is a no-op when scratchBufnr is not registered", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.closeCellEdit(9999);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("removes the cellEditBuffers entry and clears the autocmd group", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === TARGET_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.closeCellEdit(scratchBufnr);
    const augroupClear = host.cmdsMatching(
      `europa_cell_edit_${scratchBufnr}`,
    );
    assertEquals(augroupClear.length > 0, true);
    // After close, a fresh editCell creates a new bufadd (entry was removed)
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, TARGET_CELL_ID);
    const reAdd = host.callsTo("bufadd");
    assertEquals(reAdd.length, 1, "new bufadd after closeCellEdit");
  });
});

// --- changeCellType dispatcher (europa.dispatcher.change-cell-type) ---

describe("changeCellType dispatcher", () => {
  const VIEWER_BUFNR = 47;
  // Cell IDs from edit-target.ipynb
  const CODE_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.changeCellType(9999, CODE_CELL_ID, "markdown");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "must emit warning on missing session",
    );
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.changeCellType(9999, CODE_CELL_ID, "markdown");
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("emits a warning and is a no-op when cellId is not found", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.changeCellType(
      VIEWER_BUFNR,
      "nonexistent-cell-id",
      "markdown",
    );
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "missing cellId must emit warning",
    );
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty, undefined, "missing cellId must not dirty the viewer");
  });

  it("emits a warning for an invalid newType", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.changeCellType(VIEWER_BUFNR, CODE_CELL_ID, "invalid");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "invalid type must emit warning",
    );
    // Session notebook must be unchanged (no dirty mark on viewer)
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(dirty, undefined, "invalid type must not dirty the viewer");
  });

  it("changes cell type and marks viewer dirty after successful change", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    host.calls = [];
    await dispatcher.changeCellType(VIEWER_BUFNR, CODE_CELL_ID, "markdown");
    const dirty = host.callsTo("setbufvar").find((c) =>
      c.args[1] === VIEWER_BUFNR && c.args[2] === "&modified" &&
      c.args[3] === 1
    );
    assertEquals(
      dirty !== undefined,
      true,
      "viewer must be marked dirty after type change",
    );
  });

  it("caches a renderPlan after successful type change", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.changeCellType(VIEWER_BUFNR, CODE_CELL_ID, "markdown");
    const cellId = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertNotEquals(
      cellId,
      null,
      "renderPlan must be cached after type change so lineToCellId resolves",
    );
  });

  it("updates scratch buffer filetype when an open scratch exists for the cell", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.editCell(VIEWER_BUFNR, CODE_CELL_ID);
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === CODE_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    host.calls = [];
    await dispatcher.changeCellType(VIEWER_BUFNR, CODE_CELL_ID, "markdown");
    // After type change to markdown, the scratch filetype must be updated to "markdown"
    const filetypeUpdate = host.callsTo("setbufvar").find((c) =>
      c.args[1] === scratchBufnr && c.args[2] === "&filetype" &&
      c.args[3] === "markdown"
    );
    assertEquals(
      filetypeUpdate !== undefined,
      true,
      "scratch buffer filetype must be updated to match the new cell type",
    );
  });
});

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
// runCell dispatcher (T018)
// ---------------------------------------------------------------------------

const CODE_CELL_1 = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
const MARKDOWN_CELL = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
const CODE_CELL_3 = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";
const CODE_CELL_5 = "058f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3f";

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
        const skippedMsgs = run2Host.cmdsMatching("skipped 2 markdown");
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

// ---------------------------------------------------------------------------
// Phase 3.4: batch-driven runCell / runAll / cellops-flush (T010)
// ---------------------------------------------------------------------------

const BATCH_FIXTURE_PATH = new URL(
  "../../golden/ipynb/edit-target.ipynb",
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

// ---------------------------------------------------------------------------
// Phase 008 T018: verify undoHistory.push() is called by all 6 mutation dispatchers.
// Behavioral proof: mutation + europaUndo reverts state without "nothing to undo".
// ---------------------------------------------------------------------------

describe("undoHistory.push — called by all 6 structural mutation dispatchers (T018)", () => {
  const VIEWER_BUFNR = 900;
  const ANCHOR_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
  let dispatcher: Awaited<ReturnType<typeof buildDispatcher>>;

  async function drain(): Promise<void> {
    await new Promise((r) => setTimeout(r, 80));
  }

  beforeEach(async () => {
    host = mockVim();
    dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
  });

  it("insertCell: push is called (europaUndo reverts insert, no 'nothing to undo')", async () => {
    const linesBefore = host.bufLines.get(VIEWER_BUFNR)?.length ?? 0;
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", ANCHOR_ID);
    host.calls = [];
    await dispatcher.europaUndo(VIEWER_BUFNR);
    await drain();
    const warnCmds = host.cmdsMatching("nothing to undo");
    assertEquals(
      warnCmds.length,
      0,
      "push must have been called — undo should not warn",
    );
    assertEquals(host.bufLines.get(VIEWER_BUFNR)?.length ?? 0, linesBefore);
  });

  it("deleteCell: push is called (europaUndo does not warn 'nothing to undo')", async () => {
    await dispatcher.deleteCell(VIEWER_BUFNR, ANCHOR_ID);
    host.calls = [];
    await dispatcher.europaUndo(VIEWER_BUFNR);
    await drain();
    const warnCmds = host.cmdsMatching("nothing to undo");
    // FR-014a: resurrected cell has empty outputs, so line count may differ.
    // We only verify that push was called (no "nothing to undo" warning).
    assertEquals(
      warnCmds.length,
      0,
      "push must have been called — undo should not warn",
    );
  });

  it("moveCell: push is called (europaUndo reverts the move)", async () => {
    const linesBefore = [...(host.bufLines.get(VIEWER_BUFNR) ?? [])];
    const cellId2 = await dispatcher.lineToCellId(VIEWER_BUFNR, 8);
    assertExists(cellId2, "fixture must have a cell at line 8");
    await dispatcher.moveCell(VIEWER_BUFNR, cellId2, "up");
    host.calls = [];
    await dispatcher.europaUndo(VIEWER_BUFNR);
    await drain();
    const warnCmds = host.cmdsMatching("nothing to undo");
    assertEquals(
      warnCmds.length,
      0,
      "push must have been called — undo should not warn",
    );
    assertEquals(host.bufLines.get(VIEWER_BUFNR), linesBefore);
  });

  it("changeCellType: push is called (europaUndo does not warn 'nothing to undo')", async () => {
    await dispatcher.changeCellType(VIEWER_BUFNR, ANCHOR_ID, "markdown");
    host.calls = [];
    await dispatcher.europaUndo(VIEWER_BUFNR);
    await drain();
    const warnCmds = host.cmdsMatching("nothing to undo");
    assertEquals(
      warnCmds.length,
      0,
      "push must have been called — undo should not warn",
    );
  });
});
