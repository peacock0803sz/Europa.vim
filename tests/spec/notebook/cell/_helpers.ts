/**
 * Shared test helpers for cell spec files.
 */
import type { Notebook } from "../../../../schema/notebook.ts";

export function makeMinimalNotebook(cells: Notebook["cells"] = []): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  };
}

export const CELL_CODE = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
export const CELL_MD = "028f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3c";
export const CELL_RAW = "038f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3d";
