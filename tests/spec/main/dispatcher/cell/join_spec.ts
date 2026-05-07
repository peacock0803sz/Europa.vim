/**
 * BDD specs for joinCell dispatcher.
 *
 * @spec-id europa.dispatcher.join-cell
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
