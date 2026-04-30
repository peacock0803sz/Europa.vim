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
  isValidCellId,
  joinSource,
} from "../../../denops/europa/notebook/cell.ts";

describe("assignCellId", () => {
  it("returns a non-empty string", () => {
    const id = assignCellId();
    assertEquals(typeof id, "string");
    assertEquals(id.length > 0, true);
  });

  it("returns a well-formed uuid v7 (version + variant bits)", () => {
    const id = assignCellId();
    assertEquals(isValidCellId(id), true);
  });

  it("returns a different id on each call", () => {
    const id1 = assignCellId();
    const id2 = assignCellId();
    assertNotEquals(id1, id2);
  });
});

describe("joinSource", () => {
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
