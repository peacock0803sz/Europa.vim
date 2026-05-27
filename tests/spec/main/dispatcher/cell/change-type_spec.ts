/**
 * BDD specs for changeCellType dispatcher.
 *
 * @spec-id europa.dispatcher.change-cell-type
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { buildDispatcher } from "../../../../../denops/europa/main.ts";
import { mockVim } from "../../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

let host: MockHost;

// --- changeCellType dispatcher (europa.dispatcher.change-cell-type) ---

describe("changeCellType dispatcher", () => {
  const VIEWER_BUFNR = 47;
  // Cell IDs from edit-target.ipynb
  const CODE_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";

  beforeEach(() => {
    host = mockVim();
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
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
