/**
 * BDD specs for applyRenderPlan — modifiable, conceal, lazy rendering,
 * Sixel apply, and Sixel fallback; and for lineToCellId / restoreCursor.
 *
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 * @spec-id europa.view.viewer.sixel-apply
 * @spec-id europa.view.viewer.sixel-fallback
 * @spec-id europa.view.viewer.line-to-cellid
 * @spec-id europa.view.viewer.restore-cursor
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  applyRenderPlan,
  lineToCellId,
  type MagickConverter,
  restoreCursor,
} from "../../../denops/europa/view/viewer.ts";
import type { CellRange } from "../../../schema/render-plan.ts";
import { type MockHost, mockNvim, mockVim } from "../../fixtures/mock-host.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

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
