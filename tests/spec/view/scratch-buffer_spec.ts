/**
 * BDD specs for openCellEditBuffer and freezeCellEditBuffer.
 *
 * @spec-id europa.view.viewer.scratch-open
 * @spec-id europa.view.viewer.scratch-freeze
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  freezeCellEditBuffer,
  openCellEditBuffer,
} from "../../../denops/europa/view/viewer.ts";
import { type MockHost, mockVim } from "../../fixtures/mock-host.ts";
import { CODE_CELL_ID } from "./_helpers.ts";

const SCRATCH_BUFNAME = `__europa_cell_${CODE_CELL_ID}__`;

let host: MockHost;

// --- openCellEditBuffer (europa.view.viewer.scratch-open) ---

describe("openCellEditBuffer", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("registers the scratch buffer via bufadd / bufload", async () => {
    await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    const bufaddCalls = host.callsTo("bufadd");
    assertEquals(bufaddCalls.length, 1);
    assertEquals(bufaddCalls[0].args[1], SCRATCH_BUFNAME);
    const bufloadCalls = host.callsTo("bufload");
    assertEquals(bufloadCalls.length, 1);
  });

  it("sets all required buffer options for an editable scratch", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    const expected: Array<[string, unknown]> = [
      ["&buftype", "acwrite"],
      ["&swapfile", 0],
      ["&bufhidden", "hide"],
      ["&modifiable", 1],
      ["&buflisted", 0],
      ["&filetype", "python"],
      ["&modified", 0],
    ];
    for (const [name, value] of expected) {
      const call = host.callsTo("setbufvar").find((c) =>
        c.args[1] === scratchBufnr && c.args[2] === name &&
        c.args[3] === value
      );
      assertEquals(call !== undefined, true, `setbufvar ${name}=${value}`);
    }
  });

  it("injects the source lines via setbufline at line 1", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["a = 1", "b = 2", "c = 3"],
      filetype: "python",
    });
    const call = host.callsTo("setbufline").find((c) =>
      c.args[1] === scratchBufnr && c.args[2] === 1
    );
    assertEquals(call !== undefined, true);
    assertEquals(call!.args[3], ["a = 1", "b = 2", "c = 3"]);
  });

  it("records cellId / viewerBufnr as buffer-local variables", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    assertEquals(host.getBufVar(scratchBufnr, "europa_cell_id"), CODE_CELL_ID);
    assertEquals(host.getBufVar(scratchBufnr, "europa_viewer_bufnr"), 42);
  });

  it("creates an autocmd group bound to the scratch bufnr", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    const expectedGroup = `europa_cell_edit_${scratchBufnr}`;
    const augroupCmd = host.cmdsMatching(`augroup ${expectedGroup}`);
    assertEquals(augroupCmd.length > 0, true);
    const writeAutocmd = host.cmdsMatching(
      `BufWriteCmd <buffer=${scratchBufnr}>`,
    );
    assertEquals(writeAutocmd.length > 0, true);
    const wipeAutocmd = host.cmdsMatching(
      `BufWipeout <buffer=${scratchBufnr}>`,
    );
    assertEquals(wipeAutocmd.length > 0, true);
  });

  it("uses denops#request for BufWriteCmd to keep saveCellEdit synchronous", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    const writeReq = host.cmdsMatching(
      `BufWriteCmd <buffer=${scratchBufnr}> call denops#request('europa', 'saveCellEdit'`,
    );
    assertEquals(
      writeReq.length > 0,
      true,
      "BufWriteCmd must invoke denops#request to block :wq until save completes",
    );
    const writeNotify = host.cmdsMatching(
      `BufWriteCmd <buffer=${scratchBufnr}> call denops#notify`,
    );
    assertEquals(
      writeNotify.length,
      0,
      "BufWriteCmd must not use the async denops#notify path",
    );
  });

  it("opens a split window targeting the scratch bufnr", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    const splitCmd = host.cmdsMatching(`split #${scratchBufnr}`);
    assertEquals(splitCmd.length > 0, true);
  });

  it("returns the bufnr assigned by bufadd", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    assertEquals(typeof scratchBufnr, "number");
    assertEquals(scratchBufnr > 0, true);
  });

  it("focuses an existing scratch via win_gotoid when it is already in a window", async () => {
    const first = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    host.windowsHavingBuf.set(first, [1234]);
    host.calls = [];
    const reused = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
      existingScratchBufnr: first,
    });
    assertEquals(reused, first);
    const bufaddCalls = host.callsTo("bufadd");
    assertEquals(bufaddCalls.length, 0, "bufadd must not be called on reuse");
    const gotoid = host.callsTo("win_gotoid").find((c) => c.args[1] === 1234);
    assertEquals(
      gotoid !== undefined,
      true,
      "win_gotoid must target the scratch's existing window",
    );
    const bufferCmd = host.cmdsMatching(`buffer ${first}`);
    assertEquals(
      bufferCmd.length,
      0,
      ":buffer N would replace the current (viewer) window",
    );
    const splitCmd = host.cmdsMatching(`split #${first}`);
    assertEquals(
      splitCmd.length,
      0,
      "no fresh :split when an existing window already shows the scratch",
    );
  });

  it("opens a fresh split for an existing scratch that is not visible", async () => {
    const first = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    // No entry in windowsHavingBuf — scratch is loaded but hidden.
    host.calls = [];
    const reused = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
      existingScratchBufnr: first,
    });
    assertEquals(reused, first);
    const splitCmd = host.cmdsMatching(`split #${first}`);
    assertEquals(splitCmd.length > 0, true);
    const gotoidCalls = host.callsTo("win_gotoid");
    assertEquals(
      gotoidCalls.length,
      0,
      "win_gotoid must not be called when no window shows the scratch",
    );
  });
});

// --- freezeCellEditBuffer (europa.view.viewer.scratch-freeze) ---

describe("freezeCellEditBuffer", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("appends the deletion marker, locks the buffer, and warns the user", async () => {
    const scratchBufnr = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
    host.calls = [];
    await freezeCellEditBuffer(host, scratchBufnr, CODE_CELL_ID);
    const append = host.callsTo("appendbufline").find((c) =>
      c.args[1] === scratchBufnr &&
      String(c.args[3]).includes("[Cell deleted from notebook]")
    );
    assertEquals(append !== undefined, true);
    const buftype = host.callsTo("setbufvar").find((c) =>
      c.args[1] === scratchBufnr && c.args[2] === "&buftype" &&
      c.args[3] === "nofile"
    );
    assertEquals(buftype !== undefined, true);
    const modifiable = host.callsTo("setbufvar").filter((c) =>
      c.args[1] === scratchBufnr && c.args[2] === "&modifiable" &&
      c.args[3] === 0
    );
    assertEquals(modifiable.length > 0, true);
    const warn = host.cmdsMatching("WarningMsg");
    assertEquals(warn.length > 0, true);
  });
});
