/**
 * Spec for the notebook-mirror write-back distributor (Phase 3.9).
 *
 * Verifies that distributeWriteBack splits an edited mirror buffer back into
 * per-cell sources by re-scanning the live `# %% <cellId>` markers (so a
 * formatter/user line insert+delete still routes to the right cell), restores
 * untouched magic lines to their original notation, and keeps unrelated cells
 * byte-identical (FR-013 / FR-016, nbformat-pristine).
 *
 * @module tests/spec/lsp/writeback_spec
 * @spec-id europa.lsp.mirror.writeback
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Cell, Notebook } from "../../../schema/notebook.ts";
import { buildMirror } from "../../../denops/europa/lsp/mirror.ts";
import { distributeWriteBack } from "../../../denops/europa/lsp/writeback.ts";

function code(id: string, source: string): Cell {
  return {
    cell_type: "code",
    id,
    source,
    execution_count: null,
    outputs: [],
    metadata: {},
  };
}

function markdown(id: string, source: string): Cell {
  return { cell_type: "markdown", id, source, metadata: {} };
}

function nb(cells: Cell[]): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells };
}

describe("distributeWriteBack", () => {
  it("(a) round-trips an unedited mirror to the original cell sources", () => {
    const build = buildMirror(
      nb([code("c1", "a = 1"), code("c2", "print(a)")]),
    );
    const out = distributeWriteBack(build.text.split("\n"), build);
    assertEquals(out, [
      { cellId: "c1", source: "a = 1" },
      { cellId: "c2", source: "print(a)" },
    ]);
  });

  it("(b) restores an UNEDITED magic line to its original notation", () => {
    const build = buildMirror(nb([code("c1", "%timeit foo()")]));
    const out = distributeWriteBack(build.text.split("\n"), build);
    assertEquals(out, [{ cellId: "c1", source: "%timeit foo()" }]);
  });

  it("(c) keeps an EDITED magic line verbatim", () => {
    const build = buildMirror(nb([code("c1", "%timeit foo()")]));
    const lines = build.text.split("\n");
    lines[lines.indexOf("# %timeit foo()")] = "# %timeit bar()";
    const out = distributeWriteBack(lines, build);
    assertEquals(out, [{ cellId: "c1", source: "# %timeit bar()" }]);
  });

  it("(d) editing one cell leaves unrelated cells byte-identical", () => {
    const build = buildMirror(nb([code("c1", "a = 1"), code("c2", "b = 2")]));
    const lines = build.text.split("\n");
    lines[lines.indexOf("a = 1")] = "a = 100";
    const out = distributeWriteBack(lines, build);
    assertEquals(out[0], { cellId: "c1", source: "a = 100" });
    assertEquals(out[1], { cellId: "c2", source: "b = 2" });
  });

  it("(e) returns one entry per code cell in notebook order", () => {
    const build = buildMirror(
      nb([code("c1", "a = 1"), markdown("m1", "# h"), code("c2", "b = 2")]),
    );
    const out = distributeWriteBack(build.text.split("\n"), build);
    assertEquals(out.map((o) => o.cellId), ["c1", "c2"]);
  });

  it("(f) handles a line INSERTED into a cell (marker rescan, not fixed offsets)", () => {
    const build = buildMirror(nb([code("c1", "a = 1"), code("c2", "b = 2")]));
    const lines = build.text.split("\n");
    // A formatter/user inserts a line inside c1's region — line count changes.
    lines.splice(lines.indexOf("a = 1") + 1, 0, "a2 = 2");
    const out = distributeWriteBack(lines, build);
    assertEquals(out[0], { cellId: "c1", source: "a = 1\na2 = 2" });
    assertEquals(out[1], { cellId: "c2", source: "b = 2" });
  });

  it("(f') handles a line DELETED from a cell", () => {
    const build = buildMirror(
      nb([code("c1", "a = 1\na2 = 2"), code("c2", "b = 2")]),
    );
    const lines = build.text.split("\n");
    lines.splice(lines.indexOf("a2 = 2"), 1); // delete a line from c1
    const out = distributeWriteBack(lines, build);
    assertEquals(out[0], { cellId: "c1", source: "a = 1" });
    assertEquals(out[1], { cellId: "c2", source: "b = 2" });
  });
});
