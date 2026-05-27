/**
 * Spec for the notebook-mirror builder + line mapping (Phase 3.9).
 *
 * Verifies that buildMirror concatenates code cells (notebook order) under an
 * inline suppression header with `# %% <cellId>` boundary markers, that the
 * derived cellRegions / lineProvenance are consistent, and that the forward /
 * reverse line maps resolve exactly (FR-008 / FR-010 / FR-012).
 *
 * @module tests/spec/lsp/mirror_spec
 * @spec-id europa.lsp.mirror.build
 * @spec-id europa.lsp.mirror.linemap
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Cell, Notebook } from "../../../schema/notebook.ts";
import {
  buildMirror,
  mapCellLineToMirror,
  mapMirrorLineToCell,
} from "../../../denops/europa/lsp/mirror.ts";

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

describe("buildMirror — layout", () => {
  it("(a) emits suppression header, then `# %% <cellId>` marker + content per cell", () => {
    const { text } = buildMirror(
      nb([code("c1", "a = 1"), code("c2", "print(a)")]),
    );
    assertEquals(text.split("\n"), [
      "# pyright: reportUnusedExpression=false",
      "# ruff: noqa: B018, B015",
      "# %% c1",
      "a = 1",
      "# %% c2",
      "print(a)",
    ]);
  });

  it("(b) cellRegions cover code cells in order (0-based, contiguous)", () => {
    const { cellRegions } = buildMirror(
      nb([code("c1", "a = 1\nb = 2"), code("c2", "print(a)")]),
    );
    assertEquals(cellRegions, [
      { cellId: "c1", markerLine: 2, startLine: 3, endLine: 4 },
      { cellId: "c2", markerLine: 5, startLine: 6, endLine: 6 },
    ]);
  });

  it("(c) lineProvenance length == mirror line count", () => {
    const r = buildMirror(
      nb([code("c1", "a = 1\nb = 2"), code("c2", "print(a)")]),
    );
    assertEquals(r.lineProvenance.length, r.text.split("\n").length);
    assertEquals(r.lineProvenance[0], "header");
    assertEquals(r.lineProvenance[2], "marker");
    assertEquals(r.lineProvenance[3], "content");
  });

  it("(f) excludes markdown / raw cells from text and cellRegions", () => {
    const { text, cellRegions } = buildMirror(
      nb([
        code("c1", "a = 1"),
        markdown("m1", "# heading"),
        code("c2", "b = 2"),
      ]),
    );
    assertEquals(cellRegions.map((r) => r.cellId), ["c1", "c2"]);
    assert(!text.includes("heading"));
  });

  it("(g) an empty code cell occupies one line (startLine == endLine)", () => {
    const { cellRegions } = buildMirror(nb([code("e", "")]));
    assertEquals(cellRegions.length, 1);
    assertEquals(cellRegions[0].startLine, cellRegions[0].endLine);
  });
});

describe("mapMirrorLineToCell / mapCellLineToMirror", () => {
  const { cellRegions } = buildMirror(
    nb([code("c1", "a = 1\nb = 2"), code("c2", "print(a)")]),
  );

  it("(d) reverse-maps an in-region line; null for marker / header / out-of-range", () => {
    assertEquals(mapMirrorLineToCell(cellRegions, 3), {
      cellId: "c1",
      cellLine: 0,
    });
    assertEquals(mapMirrorLineToCell(cellRegions, 4), {
      cellId: "c1",
      cellLine: 1,
    });
    assertEquals(mapMirrorLineToCell(cellRegions, 6), {
      cellId: "c2",
      cellLine: 0,
    });
    assertEquals(mapMirrorLineToCell(cellRegions, 2), null); // marker
    assertEquals(mapMirrorLineToCell(cellRegions, 0), null); // header
    assertEquals(mapMirrorLineToCell(cellRegions, 99), null); // out of range
  });

  it("(e) forward-maps cell line to mirror line; null when out of range / unknown cell", () => {
    assertEquals(mapCellLineToMirror(cellRegions, "c1", 0), 3);
    assertEquals(mapCellLineToMirror(cellRegions, "c1", 1), 4);
    assertEquals(mapCellLineToMirror(cellRegions, "c2", 0), 6);
    assertEquals(mapCellLineToMirror(cellRegions, "c1", 5), null);
    assertEquals(mapCellLineToMirror(cellRegions, "missing", 0), null);
  });
});
