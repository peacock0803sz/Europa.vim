/**
 * Generates a synthetic 1000-cell notebook to stdout.
 *
 * Used once to produce tests/golden/ipynb/large-1000cells.ipynb for
 * SC-003 lazy rendering performance verification.
 *
 * @module tests/fixtures/generate-large-fixture
 */

const CELL_COUNT = 1000;

// deno-lint-ignore no-explicit-any
function makeCodeCell(i: number): Record<string, any> {
  return {
    cell_type: "code",
    id: `cell${String(i).padStart(4, "0")}-0000-4000-a000-000000000000`,
    source: `# Cell ${i}\nx_${i} = ${i}\nprint(f"Cell {i}: {x_${i}}")`,
    execution_count: i,
    outputs: i % 10 === 0
      ? [{
        output_type: "stream",
        name: "stdout",
        text: `Cell ${i}: ${i}\n`,
      }]
      : [],
    metadata: {},
  };
}

const cells = Array.from({ length: CELL_COUNT }, (_, i) => makeCodeCell(i + 1));

const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: {
      display_name: "Python 3",
      language: "python",
      name: "python3",
    },
    language_info: { name: "python" },
  },
  cells,
};

console.log(JSON.stringify(notebook, null, 1));
