/**
 * BDD specs for applyRenderPlan — modifiable, conceal, lazy rendering,
 * Sixel apply, and Sixel fallback; lineToCellId / restoreCursor; and
 * scratch buffer host I/O (openCellEditBuffer / freezeCellEditBuffer /
 * resolveScratchFiletype).
 *
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 * @spec-id europa.view.viewer.sixel-apply
 * @spec-id europa.view.viewer.sixel-fallback
 * @spec-id europa.view.viewer.line-to-cellid
 * @spec-id europa.view.viewer.restore-cursor
 * @spec-id europa.view.viewer.scratch-open
 * @spec-id europa.view.viewer.scratch-freeze
 * @spec-id europa.view.viewer.resolve-filetype
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  applyRenderPlan,
  freezeCellEditBuffer,
  lineToCellId,
  type MagickConverter,
  openCellEditBuffer,
  resolveScratchFiletype,
  restoreCursor,
} from "../../../denops/europa/view/viewer.ts";
import type { CellRange } from "../../../schema/render-plan.ts";
import { type MockHost, mockNvim, mockVim } from "../../fixtures/mock-host.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";
import type { Cell, Notebook } from "../../../schema/notebook.ts";

// Minimal 1×1 PNG base64 (same fixture as image_spec.ts)
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Minimal valid Sixel sequence for test fakes
const FAKE_SIXEL = new TextEncoder().encode("\x1bPq#0;2;0;0;0#0!1~-\x1b\\");

function emptyPlan(): RenderPlan {
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
    cellMap: [],
    cellRanges: [],
  };
}

function sixelPlan(): RenderPlan {
  return {
    ...emptyPlan(),
    sixelPlacements: [
      {
        line: 7,
        payload: PNG_B64,
        mime: "image/png",
        backend: "sixel",
        cellIdx: 0,
        outputIdx: 0,
      },
    ],
  };
}

let host: MockHost;

describe("applyRenderPlan", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("locks the target buffer via setbufvar &modifiable=0", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const lockCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&modifiable" && c.args[3] === 0
    );
    assertEquals(lockCall !== undefined, true);
  });

  it("sets conceallevel=0 via win_execute on the buffer's window", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const concealCall = host.callsTo("win_execute").find((c) =>
      String(c.args[2]).includes("conceallevel=0")
    );
    assertEquals(concealCall !== undefined, true);
  });

  it("sets &buftype=acwrite on the target buffer", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const buftypeCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&buftype" && c.args[3] === "acwrite"
    );
    assertEquals(buftypeCall !== undefined, true);
  });

  it("clears &modified on the target buffer to suppress the dirty flag", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const modifiedCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&modified" && c.args[3] === 0
    );
    assertEquals(modifiedCall !== undefined, true);
  });
});

describe("applyRenderPlan with viewport", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("renders the viewport slice at topLine+1, not at line 1", async () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const plan: RenderPlan = {
      lines: manyLines,
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [{ cellIndex: 0, bufLineStart: 0, bufLineEnd: 99 }],
      cellRanges: [],
    };
    await applyRenderPlan(host, 1, plan, {
      viewport: { topLine: 50, bottomLine: 60 },
    });
    const writeCall = host.callsTo("setbufline").find((c) => c.args[1] === 1);
    assertEquals(writeCall !== undefined, true);
    assertEquals(writeCall!.args[2], 51, "lnum must be topLine + 1");
    const slice = writeCall!.args[3] as string[];
    assertEquals(slice.length, 11, "slice length is bottomLine - topLine + 1");
    assertEquals(slice[0], "line50");
    assertEquals(slice[10], "line60");
  });

  it("limits the rendered slice to exactly the viewport range", async () => {
    const plan: RenderPlan = {
      lines: ["a", "b", "c", "d", "e"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [{ cellIndex: 0, bufLineStart: 0, bufLineEnd: 4 }],
      cellRanges: [],
    };
    await applyRenderPlan(host, 1, plan, {
      viewport: { topLine: 1, bottomLine: 3 },
    });
    const writeCall = host.callsTo("setbufline").find((c) => c.args[1] === 1);
    assertEquals(writeCall!.args[2], 2);
    assertEquals(writeCall!.args[3], ["b", "c", "d"]);
  });

  it("trims residue past plan.lines.length via deletebufline", async () => {
    const plan: RenderPlan = {
      lines: ["a", "b", "c"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [],
      cellRanges: [],
    };
    await applyRenderPlan(host, 1, plan);
    const trim = host.callsTo("deletebufline").find((c) =>
      c.args[1] === 1 &&
      c.args[2] === plan.lines.length + 1 &&
      c.args[3] === "$"
    );
    assertEquals(trim !== undefined, true);
  });
});

describe("applyRenderPlan — sixel-apply (Vim host)", () => {
  const fakeConverter: MagickConverter = () => Promise.resolve(FAKE_SIXEL);

  beforeEach(() => {
    host = mockVim();
  });

  it("calls writefile with /dev/tty when converter returns sixel data", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const ttyCall = host.callsTo("writefile").find((c) =>
      c.args[2] === "/dev/tty"
    );
    assertEquals(
      ttyCall !== undefined,
      true,
      "writefile to /dev/tty must be called",
    );
  });

  it("wraps sixel data with cursor-position move based on screenpos", async () => {
    // sixelPlan().sixelPlacements[0].line === 7 → screenpos returns row 8.
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const ttyCall = host.callsTo("writefile").find((c) =>
      c.args[2] === "/dev/tty"
    );
    const payload = (ttyCall!.args[1] as string[])[0];
    // ESC 7 (DECSC) + ESC [ row;col H + sixel + ESC 8 (DECRC).
    // sp.line=7 → screenpos returns row 8 → image anchored at row 9 (one
    // row below the placeholder so the `[image: ...]` text stays visible).
    assertEquals(payload.startsWith("\x1b7\x1b[9;1H"), true);
    assertEquals(payload.endsWith("\x1b8"), true);
  });

  it("calls redraw before reading screenpos so positions are current", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const redrawCalls = host.cmdsMatching("redraw");
    assertEquals(
      redrawCalls.length > 0,
      true,
      "redraw must run before screenpos to flush pending screen state",
    );
  });

  it("does not call chansend on Vim host", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    assertEquals(
      host.callsTo("chansend").length,
      0,
      "chansend is the Neovim path and must not run on Vim",
    );
  });
});

describe("applyRenderPlan — sixel-apply (Neovim host)", () => {
  const fakeConverter: MagickConverter = () => Promise.resolve(FAKE_SIXEL);

  beforeEach(() => {
    host = mockNvim();
    // Neovim's v:stderr channel id used by chansend.
    host.setEval("v:stderr", 2);
  });

  it("uses chansend(v:stderr, ...) instead of writefile to /dev/tty", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const chansend = host.callsTo("chansend");
    assertEquals(
      chansend.length > 0,
      true,
      "chansend must be called for Neovim Sixel write",
    );
    assertEquals(
      chansend[0].args[1],
      2,
      "first chansend arg must be the v:stderr channel id",
    );
  });

  it("wraps sixel data with cursor-position move on Neovim too", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const chansend = host.callsTo("chansend");
    const payload = chansend[0].args[2] as string;
    // sp.line=7 → screenpos returns row 8 → image anchored at row 9 (one
    // row below the placeholder so the `[image: ...]` text stays visible).
    assertEquals(payload.startsWith("\x1b7\x1b[9;1H"), true);
    assertEquals(payload.endsWith("\x1b8"), true);
  });

  it("does not call writefile to /dev/tty on Neovim host", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: fakeConverter,
    });
    const ttyCall = host.callsTo("writefile").find((c) =>
      c.args[2] === "/dev/tty"
    );
    assertEquals(
      ttyCall,
      undefined,
      "Neovim path must avoid writefile('/dev/tty') (E482).",
    );
  });
});

describe("applyRenderPlan — sixel-fallback", () => {
  const nullConverter: MagickConverter = () => Promise.resolve(null);

  beforeEach(() => {
    host = mockVim();
  });

  it("emits echohl WarningMsg when converter returns null", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: nullConverter,
    });
    const warnCmds = host.cmdsMatching("echohl");
    assertEquals(
      warnCmds.length > 0,
      true,
      "echohl WarningMsg must be emitted on fallback",
    );
  });

  it("does not call writefile to /dev/tty when conversion fails", async () => {
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: nullConverter,
    });
    const ttyCall = host.callsTo("writefile").find((c) =>
      c.args[2] === "/dev/tty"
    );
    assertEquals(
      ttyCall,
      undefined,
      "writefile to /dev/tty must NOT be called on fallback",
    );
  });

  it("does not call chansend when conversion fails", async () => {
    host = mockNvim();
    host.setEval("v:stderr", 2);
    await applyRenderPlan(host, 1, sixelPlan(), {
      _magickConverter: nullConverter,
    });
    assertEquals(
      host.callsTo("chansend").length,
      0,
      "chansend must NOT be called when sixel conversion fails",
    );
  });
});

// --- Phase 3.1: lineToCellId (europa.view.viewer.line-to-cellid) ---

describe("lineToCellId", () => {
  const ranges: CellRange[] = [
    { cellId: "cell-a", startLine: 0, endLine: 3 },
    { cellId: "cell-b", startLine: 4, endLine: 7 },
    { cellId: "cell-c", startLine: 8, endLine: 10 },
  ];

  it("returns the cellId for a line inside a range (1-origin input)", () => {
    // line 1 → 0-origin 0 → cell-a (startLine=0, endLine=3)
    assertEquals(lineToCellId(ranges, 1), "cell-a");
    // line 5 → 0-origin 4 → cell-b (startLine=4)
    assertEquals(lineToCellId(ranges, 5), "cell-b");
    // line 9 → 0-origin 8 → cell-c (startLine=8)
    assertEquals(lineToCellId(ranges, 9), "cell-c");
  });

  it("returns the cellId for boundary lines", () => {
    // startLine=0 (line 1) and endLine=3 (line 4) both belong to cell-a
    assertEquals(lineToCellId(ranges, 1), "cell-a");
    assertEquals(lineToCellId(ranges, 4), "cell-a");
    // startLine=4 (line 5) belongs to cell-b
    assertEquals(lineToCellId(ranges, 5), "cell-b");
    assertEquals(lineToCellId(ranges, 8), "cell-b");
  });

  it("returns null for a line outside all ranges", () => {
    assertEquals(lineToCellId(ranges, 12), null);
    assertEquals(lineToCellId(ranges, 100), null);
  });

  it("returns null for an empty cellRanges array", () => {
    assertEquals(lineToCellId([], 1), null);
  });
});

// --- Phase 3.1: restoreCursor (europa.view.viewer.restore-cursor) ---

describe("restoreCursor", () => {
  const newRanges: CellRange[] = [
    { cellId: "cell-a", startLine: 0, endLine: 2 },
    { cellId: "cell-b", startLine: 3, endLine: 5 },
  ];

  it("moves to hint cell when hint.preferCellId is provided", async () => {
    const h = mockVim();
    await restoreCursor(
      h,
      1,
      "cell-a",
      newRanges,
      newRanges,
      { preferCellId: "cell-b" },
    );
    const cursorCmds = h.cmdsMatching("cursor(4,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should be set to cell-b startLine+1=4",
    );
  });

  it("restores cursor to preMutationCellId when still present", async () => {
    const h = mockVim();
    await restoreCursor(h, 1, "cell-a", newRanges, newRanges);
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should be set to cell-a startLine+1=1",
    );
  });

  it("falls back to index when preMutationCellId is gone", async () => {
    const preMutationRanges: CellRange[] = [
      { cellId: "deleted-cell", startLine: 0, endLine: 2 },
      { cellId: "cell-b", startLine: 3, endLine: 5 },
    ];
    const h = mockVim();
    await restoreCursor(h, 1, "deleted-cell", preMutationRanges, newRanges);
    // deleted-cell was at index 0, so newRanges[0] = cell-a startLine+1=1
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should fall back to same index in newRanges",
    );
  });

  it("falls back to last cell when index is out of range", async () => {
    const preMutationRanges: CellRange[] = [
      { cellId: "cell-a", startLine: 0, endLine: 2 },
      { cellId: "deleted-cell", startLine: 3, endLine: 5 },
    ];
    const singleRange: CellRange[] = [
      { cellId: "cell-a", startLine: 0, endLine: 2 },
    ];
    const h = mockVim();
    // deleted-cell at index 1; newRanges only has index 0
    await restoreCursor(h, 1, "deleted-cell", preMutationRanges, singleRange);
    // index 1 >= singleRange.length → last cell = cell-a startLine+1=1
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(cursorCmds.length > 0, true);
  });

  it("moves to line 1 for empty notebook (no ranges)", async () => {
    const h = mockVim();
    await restoreCursor(h, 1, null, [], []);
    const cursorCmds = h.cmdsMatching("cursor(1, 1)");
    assertEquals(cursorCmds.length > 0, true);
  });
});

// --- resolveScratchFiletype (europa.view.viewer.resolve-filetype) ---

const CODE_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
const MD_CELL_ID = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
const RAW_CELL_ID = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";

function makeCodeCell(): Cell {
  return {
    cell_type: "code",
    id: CODE_CELL_ID,
    source: "x = 1",
    execution_count: null,
    outputs: [],
    metadata: {},
  };
}

function makeMarkdownCell(): Cell {
  return {
    cell_type: "markdown",
    id: MD_CELL_ID,
    source: "# md",
    metadata: {},
  };
}

function makeRawCell(): Cell {
  return {
    cell_type: "raw",
    id: RAW_CELL_ID,
    source: "raw",
    metadata: {},
  };
}

function makeNotebook(metadata: Notebook["metadata"], cells: Cell[]): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata, cells };
}

describe("resolveScratchFiletype", () => {
  it("returns 'markdown' for markdown cells regardless of metadata", () => {
    const nb = makeNotebook({}, [makeMarkdownCell()]);
    assertEquals(resolveScratchFiletype(nb, makeMarkdownCell()), "markdown");
  });

  it("returns '' (no filetype) for raw cells", () => {
    const nb = makeNotebook({}, [makeRawCell()]);
    assertEquals(resolveScratchFiletype(nb, makeRawCell()), "");
  });

  it("uses kernelspec.language for code cells when present", () => {
    const nb = makeNotebook(
      { kernelspec: { name: "py3", language: "python" } },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });

  it("falls back to language_info.name when kernelspec.language is absent", () => {
    const nb = makeNotebook(
      { language_info: { name: "rust" } },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "rust");
  });

  it("falls back to 'python' when neither kernelspec nor language_info is set", () => {
    const nb = makeNotebook({}, [makeCodeCell()]);
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });

  it("prefers kernelspec.language over language_info.name", () => {
    const nb = makeNotebook(
      {
        kernelspec: { name: "ruby3", language: "ruby" },
        language_info: { name: "python" },
      },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "ruby");
  });

  it("treats empty string as missing for kernelspec.language fallback", () => {
    const nb = makeNotebook(
      {
        kernelspec: { name: "py3", language: "" },
        language_info: { name: "python" },
      },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });
});

// --- openCellEditBuffer (europa.view.viewer.scratch-open) ---

const SCRATCH_BUFNAME = `__europa_cell_${CODE_CELL_ID}__`;

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

  it("reuses an existing scratch buffer rather than creating a new split", async () => {
    const first = await openCellEditBuffer(host, {
      bufname: SCRATCH_BUFNAME,
      cellId: CODE_CELL_ID,
      viewerBufnr: 42,
      sourceLines: ["x = 1"],
      filetype: "python",
    });
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
    const bufferCmd = host.cmdsMatching(`buffer ${first}`);
    assertEquals(bufferCmd.length > 0, true);
    const splitCmd = host.cmdsMatching(`split #${first}`);
    assertEquals(splitCmd.length, 0, "no fresh :split when reusing");
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
