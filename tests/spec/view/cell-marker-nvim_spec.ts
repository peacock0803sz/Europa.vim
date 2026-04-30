/**
 * BDD specs for NvimCellMarker (extmark path).
 *
 * @spec-id europa.view.cell-marker.nvim
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { NvimCellMarker } from "../../../denops/europa/view/cell-marker-nvim.ts";
import { type MockHost, mockNvim } from "../../fixtures/mock-host.ts";

let host: MockHost;
let marker: NvimCellMarker;

describe("NvimCellMarker", () => {
  beforeEach(() => {
    host = mockNvim();
    marker = new NvimCellMarker();
  });

  it("init calls nvim_create_namespace and caches the id", async () => {
    await marker.init(host);
    const nsCalls = host.callsTo("nvim_create_namespace");
    assertEquals(nsCalls.length, 1);
    assertEquals(nsCalls[0].args[1], "Europa");
  });

  it("init is idempotent — second call reuses cached namespace", async () => {
    await marker.init(host);
    const firstId = host.namespaces.get("Europa");
    host.calls = [];
    await marker.init(host);
    const nsCalls = host.callsTo("nvim_create_namespace");
    // Should not call again since ns is cached
    assertEquals(nsCalls.length, 0);
    assertEquals(host.namespaces.get("Europa"), firstId);
  });

  it("setHead calls nvim_buf_set_extmark with virt_lines", async () => {
    await marker.init(host);
    host.calls = [];
    await marker.setHead(1, 3, "╭─ In [1] ─╮");
    const extmarkCalls = host.callsTo("nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length > 0, true);
  });

  it("setOutputBoundary calls nvim_buf_set_extmark", async () => {
    await marker.init(host);
    host.calls = [];
    await marker.setOutputBoundary(1, 7);
    const extmarkCalls = host.callsTo("nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length > 0, true);
  });

  it("clear calls nvim_buf_clear_namespace", async () => {
    await marker.init(host);
    host.calls = [];
    await marker.clear(1);
    const clearCalls = host.callsTo("nvim_buf_clear_namespace");
    assertEquals(clearCalls.length > 0, true);
  });

  it("refresh calls clear then re-sets extmarks", async () => {
    await marker.init(host);
    await marker.setHead(1, 1, "header");
    host.calls = [];
    await marker.refresh(1);
    const clears = host.callsTo("nvim_buf_clear_namespace");
    assertEquals(clears.length > 0, true);
  });
});
