/**
 * BDD specs for lineToCellId, restoreCursor, and resolveScratchFiletype.
 *
 * @spec-id europa.view.viewer.line-to-cellid
 * @spec-id europa.view.viewer.restore-cursor
 * @spec-id europa.view.viewer.resolve-filetype
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  lineToCellId,
  resolveScratchFiletype,
  restoreCursor,
} from "../../../denops/europa/view/viewer.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { CellRange } from "../../../schema/render-plan.ts";
import {
  makeCodeCell,
  makeMarkdownCell,
  makeNotebook,
  makeRawCell,
} from "./_helpers.ts";

// --- lineToCellId (europa.view.viewer.line-to-cellid) ---

describe("lineToCellId", () => {
  const ranges: CellRange[] = [
    { cellId: "cell-a", startLine: 0, endLine: 3 },
    { cellId: "cell-b", startLine: 4, endLine: 7 },
    { cellId: "cell-c", startLine: 8, endLine: 10 },
  ];

  it("returns the cellId for a line inside a range (1-origin input)", () => {
    // line 1 → 0-origin 0 → cell-a (startLine=0, endLine=3)
    assertEquals(lineToCellId(ranges, 1), "cell-a");
    // line 5 → 0-origin 4 → cell-b (startLine=4)
    assertEquals(lineToCellId(ranges, 5), "cell-b");
    // line 9 → 0-origin 8 → cell-c (startLine=8)
    assertEquals(lineToCellId(ranges, 9), "cell-c");
  });

  it("returns the cellId for boundary lines", () => {
    // startLine=0 (line 1) and endLine=3 (line 4) both belong to cell-a
    assertEquals(lineToCellId(ranges, 1), "cell-a");
    assertEquals(lineToCellId(ranges, 4), "cell-a");
    // startLine=4 (line 5) belongs to cell-b
    assertEquals(lineToCellId(ranges, 5), "cell-b");
    assertEquals(lineToCellId(ranges, 8), "cell-b");
  });

  it("returns null for a line outside all ranges", () => {
    assertEquals(lineToCellId(ranges, 12), null);
    assertEquals(lineToCellId(ranges, 100), null);
  });

  it("returns null for an empty cellRanges array", () => {
    assertEquals(lineToCellId([], 1), null);
  });
});

// --- restoreCursor (europa.view.viewer.restore-cursor) ---

describe("restoreCursor", () => {
  const newRanges: CellRange[] = [
    { cellId: "cell-a", startLine: 0, endLine: 2 },
    { cellId: "cell-b", startLine: 3, endLine: 5 },
  ];

  it("moves to hint cell when hint.preferCellId is provided", async () => {
    const h = mockVim();
    await restoreCursor(
      h,
      1,
      "cell-a",
      newRanges,
      newRanges,
      { preferCellId: "cell-b" },
    );
    const cursorCmds = h.cmdsMatching("cursor(4,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should be set to cell-b startLine+1=4",
    );
  });

  it("restores cursor to preMutationCellId when still present", async () => {
    const h = mockVim();
    await restoreCursor(h, 1, "cell-a", newRanges, newRanges);
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should be set to cell-a startLine+1=1",
    );
  });

  it("falls back to index when preMutationCellId is gone", async () => {
    const preMutationRanges: CellRange[] = [
      { cellId: "deleted-cell", startLine: 0, endLine: 2 },
      { cellId: "cell-b", startLine: 3, endLine: 5 },
    ];
    const h = mockVim();
    await restoreCursor(h, 1, "deleted-cell", preMutationRanges, newRanges);
    // deleted-cell was at index 0, so newRanges[0] = cell-a startLine+1=1
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(
      cursorCmds.length > 0,
      true,
      "cursor should fall back to same index in newRanges",
    );
  });

  it("falls back to last cell when index is out of range", async () => {
    const preMutationRanges: CellRange[] = [
      { cellId: "cell-a", startLine: 0, endLine: 2 },
      { cellId: "deleted-cell", startLine: 3, endLine: 5 },
    ];
    const singleRange: CellRange[] = [
      { cellId: "cell-a", startLine: 0, endLine: 2 },
    ];
    const h = mockVim();
    // deleted-cell at index 1; newRanges only has index 0
    await restoreCursor(h, 1, "deleted-cell", preMutationRanges, singleRange);
    // index 1 >= singleRange.length → last cell = cell-a startLine+1=1
    const cursorCmds = h.cmdsMatching("cursor(1,");
    assertEquals(cursorCmds.length > 0, true);
  });

  it("moves to line 1 for empty notebook (no ranges)", async () => {
    const h = mockVim();
    await restoreCursor(h, 1, null, [], []);
    const cursorCmds = h.cmdsMatching("cursor(1, 1)");
    assertEquals(cursorCmds.length > 0, true);
  });
});

// --- resolveScratchFiletype (europa.view.viewer.resolve-filetype) ---

describe("resolveScratchFiletype", () => {
  it("returns 'markdown' for markdown cells regardless of metadata", () => {
    const nb = makeNotebook({}, [makeMarkdownCell()]);
    assertEquals(resolveScratchFiletype(nb, makeMarkdownCell()), "markdown");
  });

  it("returns '' (no filetype) for raw cells", () => {
    const nb = makeNotebook({}, [makeRawCell()]);
    assertEquals(resolveScratchFiletype(nb, makeRawCell()), "");
  });

  it("uses kernelspec.language for code cells when present", () => {
    const nb = makeNotebook(
      { kernelspec: { name: "py3", language: "python" } },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });

  it("falls back to language_info.name when kernelspec.language is absent", () => {
    const nb = makeNotebook(
      { language_info: { name: "rust" } },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "rust");
  });

  it("falls back to 'python' when neither kernelspec nor language_info is set", () => {
    const nb = makeNotebook({}, [makeCodeCell()]);
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });

  it("prefers kernelspec.language over language_info.name", () => {
    const nb = makeNotebook(
      {
        kernelspec: { name: "ruby3", language: "ruby" },
        language_info: { name: "python" },
      },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "ruby");
  });

  it("treats empty string as missing for kernelspec.language fallback", () => {
    const nb = makeNotebook(
      {
        kernelspec: { name: "py3", language: "" },
        language_info: { name: "python" },
      },
      [makeCodeCell()],
    );
    assertEquals(resolveScratchFiletype(nb, makeCodeCell()), "python");
  });
});
