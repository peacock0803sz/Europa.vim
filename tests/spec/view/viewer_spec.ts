/**
 * BDD specs for applyRenderPlan — modifiable, conceal, lazy rendering,
 * Sixel apply, and Sixel fallback.
 *
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 * @spec-id europa.view.viewer.sixel-apply
 * @spec-id europa.view.viewer.sixel-fallback
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  applyRenderPlan,
  type MagickConverter,
} from "../../../denops/europa/view/viewer.ts";
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
