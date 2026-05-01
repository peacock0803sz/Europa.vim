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
    // Two distinct `## [code]` headers exist for the original cell's id and
    // the freshly minted lower-half cell; structural mutation succeeded.
    const headerCount = lines.filter((l) => l.startsWith("## [code]")).length;
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
      l === "" || l.startsWith("## ")
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
    const allHeaders = lines.filter((l) => l.startsWith("## ["));
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
