/**
 * BDD specs for VimCellMarker (text property path).
 *
 * @spec-id europa.view.cell-marker.vim
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { VimCellMarker } from "../../../denops/europa/view/cell-marker-vim.ts";
import { type MockHost, mockVim } from "../../fixtures/mock-host.ts";

let host: MockHost;
let marker: VimCellMarker;

describe("VimCellMarker", () => {
  beforeEach(() => {
    host = mockVim();
    marker = new VimCellMarker();
  });

  it("init calls prop_type_add for unregistered types", async () => {
    await marker.init(host);
    const addCalls = host.callsTo("prop_type_add");
    assertEquals(addCalls.length > 0, true);
  });

  it("init is idempotent — calling twice does not double-add", async () => {
    // Second call simulates types already registered
    await marker.init(host);
    const countAfterFirst = host.callsTo("prop_type_add").length;
    // Simulate prop_type_list returning the registered types
    host.calls = [];
    host.setEval("prop_type_list()", ["EuropaCellHead", "EuropaCellOut"]);
    // Mock prop_type_list function return
    await marker.init(host);
    // With existing types registered, no new adds for those types
    const addCalls2 = host.callsTo("prop_type_add");
    assertEquals(addCalls2.length < countAfterFirst, true);
  });

  it("setHead calls prop_add on the given buffer and line", async () => {
    await marker.init(host);
    host.calls = [];
    await marker.setHead(1, 5, "╭─ In [1] ─╮");
    const propAdds = host.callsTo("prop_add");
    assertEquals(propAdds.length > 0, true);
  });

  it("setOutputBoundary calls prop_add", async () => {
    await marker.init(host);
    host.calls = [];
    await marker.setOutputBoundary(1, 10, "╰─ Out [1] ─╯");
    const propAdds = host.callsTo("prop_add");
    assertEquals(propAdds.length > 0, true);
  });

  it("clear calls prop_remove", async () => {
    await marker.init(host);
    await marker.setHead(1, 1, "header");
    host.calls = [];
    await marker.clear(1);
    const removes = host.callsTo("prop_remove");
    assertEquals(removes.length > 0, true);
  });

  it("refresh calls clear then re-adds markers", async () => {
    await marker.init(host);
    await marker.setHead(1, 1, "header");
    host.calls = [];
    await marker.refresh(1);
    const removes = host.callsTo("prop_remove");
    const adds = host.callsTo("prop_add");
    assertEquals(removes.length > 0, true);
    assertEquals(adds.length > 0, true);
  });
});
