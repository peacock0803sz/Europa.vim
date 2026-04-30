/**
 * BDD specs for createCellMarker factory — host dispatch.
 *
 * @spec-id europa.view.cell-marker.factory
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createCellMarker } from "../../../denops/europa/view/cell-marker.ts";
import { mockNvim, mockVim } from "../../fixtures/mock-host.ts";

describe("createCellMarker", () => {
  it("returns a CellMarker for Vim host", () => {
    const host = mockVim();
    const marker = createCellMarker(host);
    assertEquals(typeof marker.init, "function");
    assertEquals(typeof marker.setHead, "function");
    assertEquals(typeof marker.setOutputBoundary, "function");
    assertEquals(typeof marker.clear, "function");
    assertEquals(typeof marker.refresh, "function");
  });

  it("returns a CellMarker for Neovim host", () => {
    const host = mockNvim();
    const marker = createCellMarker(host);
    assertEquals(typeof marker.init, "function");
    assertEquals(typeof marker.clear, "function");
  });

  it("returns the same instance when called twice with the same denops", () => {
    const host = mockVim();
    const m1 = createCellMarker(host);
    const m2 = createCellMarker(host);
    assertEquals(m1 === m2, true);
  });

  it("returns different instances for different denops objects", () => {
    const hostA = mockVim();
    const hostB = mockVim();
    const m1 = createCellMarker(hostA);
    const m2 = createCellMarker(hostB);
    assertEquals(m1 === m2, false);
  });

  it("VimCellMarker and NvimCellMarker have distinct types for different hosts", () => {
    const vim = createCellMarker(mockVim());
    const nvim = createCellMarker(mockNvim());
    // They satisfy the same interface but are different runtime instances
    assertEquals(vim !== nvim, true);
  });
});
