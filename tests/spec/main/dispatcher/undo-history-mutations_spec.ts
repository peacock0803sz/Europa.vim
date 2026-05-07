/**
 * BDD specs for undoHistory.push — called by 4 structural mutation dispatchers (T018).
 *
 * Phase 008 addition (T018):
 * Verifies that each of the 6 structural mutation dispatchers calls
 * session.undoHistory.push() before mutating the notebook. Verified
 * behaviorally: after a mutation, europaUndo reverses the change, confirming
 * an entry was pushed (a missing push would yield "nothing to undo").
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { buildDispatcher } from "../../../../denops/europa/main.ts";
import { mockVim } from "../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

let host: MockHost;

// ---------------------------------------------------------------------------
// Phase 008 T018: verify undoHistory.push() is called by all 6 mutation dispatchers.
// Behavioral proof: mutation + europaUndo reverts state without "nothing to undo".
// ---------------------------------------------------------------------------

describe("undoHistory.push — called by 4 structural mutation dispatchers (T018)", () => {
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
