/**
 * Shared test helpers for viewer spec files.
 */
import type { Cell, Notebook } from "../../../schema/notebook.ts";

// Minimal 1x1 PNG base64 (same fixture as image_spec.ts)
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Minimal valid Sixel sequence for test fakes
export const FAKE_SIXEL = new TextEncoder().encode(
  "\x1bPq#0;2;0;0;0#0!1~-\x1b\\",
);

export const CODE_CELL_ID = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
export const MD_CELL_ID = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
export const RAW_CELL_ID = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";

import type { RenderPlan } from "../../../schema/render-plan.ts";

export function emptyPlan(): RenderPlan {
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
    cellMap: [],
    cellRanges: [],
  };
}

export function sixelPlan(): RenderPlan {
  return {
    ...emptyPlan(),
    sixelPlacements: [
      {
        line: 7,
        payload: PNG_B64,
        mime: "image/png",
        backend: "sixel",
        cellIdx: 0,
        outputIdx: 0,
      },
    ],
  };
}

export function makeCodeCell(): Cell {
  return {
    cell_type: "code",
    id: CODE_CELL_ID,
    source: "x = 1",
    execution_count: null,
    outputs: [],
    metadata: {},
  };
}

export function makeMarkdownCell(): Cell {
  return {
    cell_type: "markdown",
    id: MD_CELL_ID,
    source: "# md",
    metadata: {},
  };
}

export function makeRawCell(): Cell {
  return {
    cell_type: "raw",
    id: RAW_CELL_ID,
    source: "raw",
    metadata: {},
  };
}

export function makeNotebook(
  metadata: Notebook["metadata"],
  cells: Cell[],
): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata, cells };
}
