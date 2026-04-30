/**
 * BDD specs for cell helpers: assignCellId and joinSource.
 *
 * @spec-id europa.notebook.cell.assign-id
 * @spec-id europa.notebook.cell.join-source
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import {
  assignCellId,
  joinSource,
} from "../../../denops/europa/notebook/cell.ts";

describe("assignCellId / @spec-id europa.notebook.cell.assign-id", () => {
  it("returns a non-empty string", () => {
    const id = assignCellId();
    assertEquals(typeof id, "string");
    assertEquals(id.length > 0, true);
  });

  it("matches the uuid v4 character set (alphanumeric + hyphen)", () => {
    const id = assignCellId();
    // uuid v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    assertEquals(/^[0-9a-f-]+$/.test(id), true);
  });

  it("returns a different id on each call", () => {
    const id1 = assignCellId();
    const id2 = assignCellId();
    assertNotEquals(id1, id2);
  });
});

describe("joinSource / @spec-id europa.notebook.cell.join-source", () => {
  it("returns a string argument unchanged", () => {
    assertEquals(joinSource("hello"), "hello");
    assertEquals(joinSource(""), "");
  });

  it("joins a string[] with empty separator (jupyter convention)", () => {
    assertEquals(joinSource(["a\n", "b\n", "c"]), "a\nb\nc");
  });

  it("returns empty string for empty array", () => {
    assertEquals(joinSource([]), "");
  });

  it("handles a single-element array", () => {
    assertEquals(joinSource(["only"]), "only");
  });
});
