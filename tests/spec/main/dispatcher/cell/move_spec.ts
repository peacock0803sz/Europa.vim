/**
 * BDD specs for moveCell dispatcher.
 *
 * @spec-id europa.dispatcher.move-cell
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
