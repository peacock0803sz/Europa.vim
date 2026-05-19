/**
 * BDD specs for markdown overlay lifecycle dispatcher/autocmd plumbing.
 *
 * @spec-id europa.dispatcher.md-overlay-scroll
 * @spec-id europa.dispatcher.md-overlay-wipeout
 * @spec-id europa.session.events.md-overlay-scroll
 * @spec-id europa.session.events.md-overlay-wipeout
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildDispatcher } from "../../../../denops/europa/main.ts";
import { setupAutocmds } from "../../../../denops/europa/session/events.ts";
import {
  __resetMdOverlayForTest,
  applyMdDecorations,
} from "../../../../denops/europa/view/markdown-overlay-nvim.ts";
import {
  type MockHost,
  mockNvim,
  mockVim,
} from "../../../fixtures/mock-host.ts";

const decorations = [
  { line: 0, colStart: 0, colEnd: 2, conceal: "", hlGroup: "EuropaMdBold" },
  { line: 35, colStart: 2, colEnd: 6, hlGroup: "EuropaMdLink" },
];

describe("markdown overlay lifecycle autocmd registration", () => {
  it("registers WinScrolled *.ipynb notify for markdown overlay scroll", async () => {
    const host = mockVim();
    await setupAutocmds(host);

    const cmds = host.cmdsMatching("WinScrolled");
    const hasNotify = cmds.some((c) =>
      String(c.args[0]).includes("WinScrolled") &&
      String(c.args[0]).includes("onMdOverlayScroll")
    );
    assertEquals(hasNotify, true);
  });

  it("registers BufWipeout *.ipynb notify for markdown overlay wipeout", async () => {
    const host = mockVim();
    await setupAutocmds(host);

    const cmds = host.cmdsMatching("BufWipeout");
    const hasNotify = cmds.some((c) =>
      String(c.args[0]).includes("BufWipeout") &&
      String(c.args[0]).includes("onMdOverlayWipeout")
    );
    assertEquals(hasNotify, true);
  });
});

describe("markdown overlay lifecycle dispatcher", () => {
  let host: MockHost;

  beforeEach(() => {
    __resetMdOverlayForTest();
    host = mockNvim();
    const originalCall = host.call.bind(host);
    host.call = ((fn: string, ...args: unknown[]) => {
      if (fn === "getwininfo") {
        host.calls.push({ method: "call", args: [fn, ...args] });
        return Promise.resolve([{ topline: 31, botline: 35 }]);
      }
      return originalCall(fn, ...args);
    }) as typeof host.call;
  });

  it("onMdOverlayScroll is a no-op when no cached overlay state exists", async () => {
    const dispatcher = buildDispatcher(host);

    await dispatcher.onMdOverlayScroll(1);

    assertEquals(host.callsTo("bufwinid").length, 1);
    assertEquals(host.callsTo("getwininfo").length, 1);
    assertEquals(host.callsTo("nvim_buf_del_extmark").length, 0);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 0);
  });

  it("onMdOverlayScroll resolves the viewport and applies extmark diffs when cached state exists", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    host.calls = [];
    const dispatcher = buildDispatcher(host);

    await dispatcher.onMdOverlayScroll(1);

    assertEquals(host.callsTo("bufwinid").length, 1);
    assertEquals(host.callsTo("getwininfo").length, 1);
    assertEquals(host.callsTo("nvim_buf_del_extmark").length, 1);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 1);
  });

  it("onMdOverlayWipeout clears markdown overlay extmarks", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    host.calls = [];
    const dispatcher = buildDispatcher(host);

    await dispatcher.onMdOverlayWipeout(1);

    assertEquals(host.callsTo("nvim_buf_clear_namespace").length, 1);
  });
});
