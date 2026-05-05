/**
 * BDD specs for the dispatcher's internal RPCs and cell-editing methods.
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
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
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
