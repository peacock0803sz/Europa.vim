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
import { mockVim } from "../../fixtures/mock-host.ts";

describe("openViewerPopup / @spec-id europa.view.popup.basic", () => {
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

describe("closePopup / @spec-id europa.view.popup.basic", () => {
  it("issues a close command for the given popup id", async () => {
    const host = mockVim();
    const id = await openViewerPopup(host, { lines: ["msg"] });
    host.calls = [];
    await closePopup(host, id);
    assertEquals(host.calls.length > 0, true);
  });
});
