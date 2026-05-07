/**
 * BDD specs for applyRenderPlan sixel-apply (Vim + Neovim) and sixel-fallback.
 *
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
import { FAKE_SIXEL, sixelPlan } from "./_helpers.ts";

let host: MockHost;

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
