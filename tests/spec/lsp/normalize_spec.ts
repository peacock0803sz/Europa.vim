/**
 * Spec for the notebook-mirror cell normalizer (Phase 3.9).
 *
 * Verifies that notebook-only syntax (line magic / shell escape / help / cell
 * magic) is commented out in place (line count preserved) with reversible
 * provenance, and that ordinary code passes through verbatim (FR-012a–d).
 *
 * @module tests/spec/lsp/normalize_spec
 * @spec-id europa.lsp.mirror.normalize
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  denormalizeLine,
  normalizeCell,
} from "../../../denops/europa/lsp/normalize.ts";

describe("normalizeCell — notebook-only syntax", () => {
  it("(a) comments a line magic in place, preserving line count", () => {
    const { lines, provenance } = normalizeCell("%timeit foo()");
    assertEquals(lines, ["# %timeit foo()"]);
    assertEquals(provenance, [{ kind: "magic", original: "%timeit foo()" }]);
  });

  it("(b) comments a shell escape (leading !)", () => {
    const { lines, provenance } = normalizeCell("!ls");
    assertEquals(lines, ["# !ls"]);
    assertEquals(provenance, [{ kind: "magic", original: "!ls" }]);
  });

  it("(c) comments a help line (trailing ? / ??)", () => {
    assertEquals(normalizeCell("obj?").lines, ["# obj?"]);
    assertEquals(normalizeCell("obj?").provenance, [
      { kind: "magic", original: "obj?" },
    ]);
    assertEquals(normalizeCell("obj??").lines, ["# obj??"]);
    assertEquals(normalizeCell("obj??").provenance, [
      { kind: "magic", original: "obj??" },
    ]);
  });

  it("(d) comments the WHOLE cell when the first line is a cell magic", () => {
    const { lines, provenance } = normalizeCell("%%bash\necho hi");
    assertEquals(lines, ["# %%bash", "# echo hi"]);
    assertEquals(provenance, [
      { kind: "magic", original: "%%bash" },
      { kind: "magic", original: "echo hi" },
    ]);
  });

  it("(e) leaves ordinary code verbatim with content provenance", () => {
    const { lines, provenance } = normalizeCell("x = 1\ny = 2");
    assertEquals(lines, ["x = 1", "y = 2"]);
    assertEquals(provenance, ["content", "content"]);
  });

  it("invariant: lines.length === provenance.length === input line count", () => {
    const src = "import os\n%timeit f()\nx = 1";
    const { lines, provenance } = normalizeCell(src);
    assertEquals(lines.length, 3);
    assertEquals(provenance.length, 3);
  });

  it("an empty cell yields exactly one empty content line", () => {
    const { lines, provenance } = normalizeCell("");
    assertEquals(lines, [""]);
    assertEquals(provenance, ["content"]);
  });
});

describe("denormalizeLine — reverse mapping", () => {
  it("(f) restores the original for an UNEDITED magic line", () => {
    const prov = { kind: "magic", original: "%timeit foo()" } as const;
    assertEquals(denormalizeLine("# %timeit foo()", prov), "%timeit foo()");
  });

  it("(g) keeps the buffer line verbatim for an EDITED magic line", () => {
    const prov = { kind: "magic", original: "%timeit foo()" } as const;
    assertEquals(denormalizeLine("# edited line", prov), "# edited line");
  });

  it("(h) returns a content line verbatim", () => {
    assertEquals(denormalizeLine("x = 1", "content"), "x = 1");
  });

  it("(i) drops marker / header lines (returns null)", () => {
    assertEquals(denormalizeLine("# %% cell-1", "marker"), null);
    assertEquals(denormalizeLine("# pyright: x=false", "header"), null);
  });

  it("(j) round-trips an unedited normalized cell back to its source", () => {
    const src = "import os\n%timeit f()\n!ls\ndf";
    const { lines, provenance } = normalizeCell(src);
    const restored = lines
      .map((line, i) => denormalizeLine(line, provenance[i]))
      .filter((l): l is string => l !== null)
      .join("\n");
    assertEquals(restored, src);
  });
});
