/**
 * BDD specs for the Neovim markdown overlay adapter.
 *
 * @spec-id europa.render.markdown.viewport-gating
 * @spec-id europa.render.markdown.cursor-line-conceal
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import type { MdDecoration } from "../../../schema/render-plan.ts";
import {
  __resetMdOverlayForTest,
  applyMdDecorations,
  clearMdOverlay,
  ensureMdOverlayBufferOptions,
  onMdOverlayScroll,
  onViewportScrolled,
} from "../../../denops/europa/view/markdown-overlay-nvim.ts";
import { type MockHost, mockNvim, mockVim } from "../../fixtures/mock-host.ts";

let host: MockHost;

const decorations: MdDecoration[] = [
  { line: 0, colStart: 0, colEnd: 2, conceal: "", hlGroup: "EuropaMdBold" },
  {
    line: 15,
    colStart: 1,
    colEnd: 4,
    virtText: "py",
    virtTextHlGroup: "EuropaMdFenceLang",
  },
  { line: 20, colStart: 0, colEnd: 1, hlGroup: "EuropaMdQuote", hlEol: true },
  { line: 35, colStart: 2, colEnd: 6, hlGroup: "EuropaMdLink" },
];

describe("markdown overlay nvim adapter", () => {
  beforeEach(() => {
    __resetMdOverlayForTest();
    host = mockNvim();
  });

  it("applyMdDecorations filters by viewport +/- 10", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 20, bottom: 25 });
    const extmarkCalls = host.callsTo("nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length, 2);
  });

  it("onViewportScrolled removes only scrolled-out extmarks and adds only newly visible extmarks", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    host.calls = [];

    await onViewportScrolled(
      host,
      1,
      decorations,
      { top: 1, bottom: 10 },
      { top: 31, bottom: 35 },
    );

    const delCalls = host.callsTo("nvim_buf_del_extmark");
    const addCalls = host.callsTo("nvim_buf_set_extmark");
    assertEquals(delCalls.length, 2);
    assertEquals(addCalls.length, 2);
  });

  it("clearMdOverlay clears the namespace once", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    host.calls = [];

    await clearMdOverlay(host, 1);

    const clearCalls = host.callsTo("nvim_buf_clear_namespace");
    assertEquals(clearCalls.length, 1);
  });

  it("applyMdDecorations records lastState so a subsequent onMdOverlayScroll can diff against it", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    host.calls = [];

    await onMdOverlayScroll(host, 1, { top: 31, bottom: 35 });

    assertEquals(host.callsTo("nvim_buf_del_extmark").length, 2);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 2);
  });

  it("clearMdOverlay also clears lastState", async () => {
    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    await clearMdOverlay(host, 1);
    host.calls = [];

    await onMdOverlayScroll(host, 1, { top: 31, bottom: 35 });

    assertEquals(host.callsTo("nvim_buf_del_extmark").length, 0);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 0);
  });

  it("ensureMdOverlayBufferOptions sets conceal options on the buffer", async () => {
    await ensureMdOverlayBufferOptions(host, 1);
    const calls = host.callsTo("setbufvar");
    assertEquals(
      calls.some((c) =>
        c.args[1] === 1 && c.args[2] === "&conceallevel" && c.args[3] === 2
      ),
      true,
    );
    assertEquals(
      calls.some((c) =>
        c.args[1] === 1 && c.args[2] === "&concealcursor" && c.args[3] === ""
      ),
      true,
    );
  });

  it("ensureMdOverlayBufferOptions is idempotent", async () => {
    await ensureMdOverlayBufferOptions(host, 1);
    await ensureMdOverlayBufferOptions(host, 1);
    assertEquals(host.getBufVar(1, "&conceallevel"), 2);
    assertEquals(host.getBufVar(1, "&concealcursor"), "");
  });

  it("public functions are no-ops on Vim hosts", async () => {
    host = mockVim();

    await applyMdDecorations(host, 1, decorations, { top: 1, bottom: 10 });
    await onViewportScrolled(
      host,
      1,
      decorations,
      { top: 1, bottom: 10 },
      { top: 21, bottom: 30 },
    );
    await clearMdOverlay(host, 1);
    await ensureMdOverlayBufferOptions(host, 1);

    assertEquals(host.callsTo("nvim_create_namespace").length, 0);
    assertEquals(host.callsTo("nvim_buf_set_extmark").length, 0);
    assertEquals(host.callsTo("nvim_buf_del_extmark").length, 0);
    assertEquals(host.callsTo("nvim_buf_clear_namespace").length, 0);
  });
});
