/**
 * BDD specs for openViewerPopup / closePopup.
 *
 * @spec-id europa.view.popup.basic
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  closePopup,
  openViewerPopup,
} from "../../../denops/europa/view/popup.ts";
import { mockNvim, mockVim } from "../../fixtures/mock-host.ts";

describe("openViewerPopup", () => {
  it("returns a numeric popup id", async () => {
    const host = mockVim();
    const id = await openViewerPopup(host, { lines: ["hello"] });
    assertEquals(typeof id, "number");
  });

  it("issues a popup creation command", async () => {
    const host = mockVim();
    await openViewerPopup(host, { lines: ["content"] });
    // Some cmd or call was issued for popup creation
    assertEquals(host.calls.length > 0, true);
  });
});

describe("closePopup", () => {
  it("issues a close command for the given popup id", async () => {
    const host = mockVim();
    const id = await openViewerPopup(host, { lines: ["msg"] });
    host.calls = [];
    await closePopup(host, id);
    assertEquals(host.calls.length > 0, true);
  });
});

describe("openViewerPopup on Neovim", () => {
  it("uses nvim_open_win instead of popup_create", async () => {
    const host = mockNvim();
    await openViewerPopup(host, { lines: ["hello"] });
    assertEquals(host.callsTo("nvim_open_win").length > 0, true);
    assertEquals(host.callsTo("popup_create").length, 0);
  });
});

describe("closePopup on Neovim", () => {
  it("uses nvim_win_close instead of popup_close", async () => {
    const host = mockNvim();
    const id = await openViewerPopup(host, { lines: ["msg"] });
    host.calls = [];
    await closePopup(host, id);
    assertEquals(host.callsTo("nvim_win_close").length > 0, true);
    assertEquals(host.callsTo("popup_close").length, 0);
  });
});
