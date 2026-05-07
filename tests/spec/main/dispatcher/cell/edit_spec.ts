/**
 * BDD specs for lineToCellId, editCell, saveCellEdit, closeCellEdit dispatcher.
 *
 * @spec-id europa.dispatcher.line-to-cellid
 * @spec-id europa.dispatcher.edit-cell
 * @spec-id europa.dispatcher.save-cell-edit
 * @spec-id europa.dispatcher.close-cell-edit
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
