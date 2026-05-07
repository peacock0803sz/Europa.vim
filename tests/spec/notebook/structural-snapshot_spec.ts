/**
 * BDD specs for structural-snapshot pure functions.
 *
 * Verifies that takeStructuralSnapshot excludes outputs / execution_count,
 * and that restoreStructural correctly merges the snapshot onto the live
 * notebook while preserving the current outputs / execution_count.
 *
 * @spec-id europa.notebook.structural-snapshot.take
 * @spec-id europa.notebook.structural-snapshot.restore-keep-outputs
 * @spec-id europa.notebook.structural-snapshot.restore-resurrect-empty-outputs
 * @spec-id europa.notebook.structural-snapshot.restore-keep-execution-count
 * @spec-id europa.notebook.structural-snapshot.restore-resurrect-null-execution-count
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  restoreStructural,
  takeStructuralSnapshot,
} from "../../../denops/europa/notebook/structural-snapshot.ts";
import type { Notebook } from "../../../schema/notebook.ts";

function makeNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: "python3" } },
    cells: [
      {
        cell_type: "code",
        id: "cell-a",
        source: "print('a')",
        execution_count: 1,
        outputs: [{ output_type: "stream", name: "stdout", text: "a\n" }],
        metadata: {},
      },
      {
        cell_type: "markdown",
        id: "cell-b",
        source: "# Title",
        metadata: {},
      },
    ],
  };
}

describe("takeStructuralSnapshot — excludes non-structural fields", () => {
  it("snapshot cells do not contain outputs", () => {
    const nb = makeNotebook();
    const snap = takeStructuralSnapshot(nb);
    for (const cell of snap.cells) {
      assertEquals(
        "outputs" in cell,
        false,
        `cell ${cell.id} should not have outputs in snapshot`,
      );
    }
  });

  it("snapshot code cells do not contain execution_count", () => {
    const nb = makeNotebook();
    const snap = takeStructuralSnapshot(nb);
    for (const cell of snap.cells) {
      assertEquals(
        "execution_count" in cell,
        false,
        `cell ${cell.id} should not have execution_count in snapshot`,
      );
    }
  });

  it("snapshot preserves cell id, source, cell_type, and metadata", () => {
    const nb = makeNotebook();
    const snap = takeStructuralSnapshot(nb);
    assertEquals(snap.cells[0].id, "cell-a");
    assertEquals(snap.cells[0].source, "print('a')");
    assertEquals(snap.cells[0].cell_type, "code");
    assertEquals(snap.cells[1].id, "cell-b");
    assertEquals(snap.cells[1].cell_type, "markdown");
  });

  it("snapshot preserves notebook metadata", () => {
    const nb = makeNotebook();
    const snap = takeStructuralSnapshot(nb);
    assertEquals(snap.metadata, nb.metadata);
  });

  it("snapshot preserves cell order", () => {
    const nb = makeNotebook();
    const snap = takeStructuralSnapshot(nb);
    assertEquals(snap.cells.length, 2);
    assertEquals(snap.cells[0].id, "cell-a");
    assertEquals(snap.cells[1].id, "cell-b");
  });
});

describe("restoreStructural — keeps current outputs (FR-014a)", () => {
  it("restores source while keeping the live outputs of surviving cells", () => {
    const original = makeNotebook();
    const snap = takeStructuralSnapshot(original);

    // Mutate: change source, add more outputs, change execution_count
    const mutated: Notebook = {
      ...original,
      cells: [
        {
          cell_type: "code",
          id: "cell-a",
          source: "print('mutated')",
          execution_count: 5,
          outputs: [
            { output_type: "stream", name: "stdout", text: "mutated\n" },
            { output_type: "stream", name: "stderr", text: "err\n" },
          ],
          metadata: {},
        },
        {
          cell_type: "markdown",
          id: "cell-b",
          source: "# Mutated Title",
          metadata: {},
        },
      ],
    };

    // Restore: source should roll back, but outputs should come from mutated
    const restored = restoreStructural(mutated, snap);
    const restoredCode = restored.cells.find((c) => c.id === "cell-a")!;
    assertEquals(restoredCode.source, "print('a')");
    // outputs preserved from mutated (not from snapshot)
    assertEquals(
      "outputs" in restoredCode
        ? (restoredCode as { outputs: unknown[] }).outputs.length
        : -1,
      2,
    );
  });
});

describe("restoreStructural — resurrects deleted cells with empty outputs", () => {
  it("a deleted cell is restored with outputs: []", () => {
    const original = makeNotebook();
    const snap = takeStructuralSnapshot(original);

    // Mutate: delete cell-a
    const mutated: Notebook = {
      ...original,
      cells: [
        {
          cell_type: "markdown",
          id: "cell-b",
          source: "# Title",
          metadata: {},
        },
      ],
    };

    const restored = restoreStructural(mutated, snap);
    const restoredCode = restored.cells.find((c) => c.id === "cell-a");
    assertEquals(restoredCode !== undefined, true);
    // Resurrected code cell gets empty outputs
    const outputs = (restoredCode as { outputs?: unknown[] }).outputs;
    assertEquals(outputs, []);
  });
});

describe("restoreStructural — keeps current execution_count", () => {
  it("restores source while keeping the live execution_count of surviving cells", () => {
    const original = makeNotebook();
    const snap = takeStructuralSnapshot(original);

    const mutated: Notebook = {
      ...original,
      cells: [
        {
          cell_type: "code",
          id: "cell-a",
          source: "print('mutated')",
          execution_count: 7,
          outputs: [],
          metadata: {},
        },
        {
          cell_type: "markdown",
          id: "cell-b",
          source: "# Title",
          metadata: {},
        },
      ],
    };

    const restored = restoreStructural(mutated, snap);
    const restoredCode = restored.cells.find((c) => c.id === "cell-a")!;
    // execution_count preserved from mutated
    const ec = (restoredCode as { execution_count?: number | null })
      .execution_count;
    assertEquals(ec, 7);
  });
});

describe("restoreStructural — resurrected cells get execution_count: null", () => {
  it("a deleted code cell is restored with execution_count: null", () => {
    const original = makeNotebook();
    const snap = takeStructuralSnapshot(original);

    // Delete cell-a from the live notebook
    const mutated: Notebook = {
      ...original,
      cells: [
        {
          cell_type: "markdown",
          id: "cell-b",
          source: "# Title",
          metadata: {},
        },
      ],
    };

    const restored = restoreStructural(mutated, snap);
    const restoredCode = restored.cells.find((c) => c.id === "cell-a");
    assertEquals(restoredCode !== undefined, true);
    const ec = (restoredCode as { execution_count?: number | null })
      .execution_count;
    assertEquals(ec, null);
  });
});
