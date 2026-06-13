/**
 * Performance regression guard for mirror generation (Phase 3.9, SC-009).
 *
 * SC-009 sets a 500ms upper bound for materializing a ~50-cell notebook's
 * mirror. The pure `buildMirror` transform is the deterministic core of that
 * cost, so this guard catches an order-of-magnitude regression without the
 * flakiness of an end-to-end wall-clock test.
 *
 * @module tests/spec/lsp/mirror_perf_spec
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Cell, Notebook } from "../../../schema/notebook.ts";
import { buildMirror } from "../../../denops/europa/lsp/mirror.ts";

function bigNotebook(cellCount: number): Notebook {
  const cells: Cell[] = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push({
      cell_type: "code",
      id: `c${i}`,
      source: `x${i} = ${i}\ny${i} = x${i} + 1\nprint(y${i})`,
      execution_count: null,
      outputs: [],
      metadata: {},
    });
  }
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells };
}

describe("buildMirror performance (SC-009)", () => {
  it("builds a ~50-cell mirror well under the 500ms upper bound", () => {
    const notebook = bigNotebook(50);
    const start = performance.now();
    const result = buildMirror(notebook);
    const elapsedMs = performance.now() - start;

    assertEquals(result.cellRegions.length, 50);
    // Generous threshold: the pure transform is microseconds; this only trips
    // on an order-of-magnitude regression (SC-009 is an upper bound, not a SLA).
    assert(
      elapsedMs < 500,
      `buildMirror(50 cells) took ${
        elapsedMs.toFixed(1)
      }ms (SC-009 bound 500ms)`,
    );
  });
});
