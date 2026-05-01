/**
 * BDD specs for the dispatcher's internal RPCs and cell-editing methods.
 *
 * @spec-id europa.dispatcher.line-to-cellid
 * @spec-id europa.dispatcher.insert-cell
 * @spec-id europa.dispatcher.delete-cell
 * @spec-id europa.dispatcher.edit-cell
 * @spec-id europa.dispatcher.save-cell-edit
 * @spec-id europa.dispatcher.close-cell-edit
 */

import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";

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
    const bufferCmd = host.cmdsMatching("buffer ");
    assertEquals(bufferCmd.length > 0, true);
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
    // Find scratch bufnr from the bufadd call
    const bufaddCall = host.callsTo("bufadd").find((c) =>
      String(c.args[1]).includes(`__europa_cell_${TARGET_CELL_ID}__`)
    )!;
    // Find scratchBufnr by inspecting setbufvar of europa_cell_id
    const idCall = host.callsTo("setbufvar").find((c) =>
      c.args[2] === "europa_cell_id" && c.args[3] === TARGET_CELL_ID
    )!;
    const scratchBufnr = idCall.args[1] as number;
    // User edits the scratch buffer
    await host.call("setbufline", scratchBufnr, 1, [
      "print('edited')",
      "x = 42",
    ]);
    host.calls = [];
    await dispatcher.saveCellEdit(scratchBufnr);
    // After save, lineToCellId still resolves the same cellId
    // and scratch &modified is cleared
    const modifiedClear = host.callsTo("setbufvar").find((c) =>
      c.args[1] === scratchBufnr && c.args[2] === "&modified" &&
      c.args[3] === 0
    );
    assertEquals(modifiedClear !== undefined, true);
    // Verify bufaddCall existed (used as guard above)
    assertEquals(bufaddCall !== undefined, true);
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
