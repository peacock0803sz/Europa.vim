/**
 * Dispatcher benchmarks — functional completeness and O(N) sanity check.
 *
 * Verifies that `insertCell` and `deleteCell` complete without error on
 * notebooks of varying sizes, and that wall-clock time grows roughly
 * linearly with the number of operations.
 *
 * SC-006 reference value: each operation should finish within 200 ms for
 * a 100-cell notebook. The benchmark does NOT assert a hard wall-clock
 * threshold — CI should not fail due to environment variance. The 200 ms
 * target is a quickstart Step 2 hand-check value.
 *
 * No @spec-id tags: bench files are outside tests/spec/**\/*_spec.ts glob
 * and must not contribute to the bijection check (Codex review M3-r3).
 */

import { buildDispatcher } from "../../denops/europa/main.ts";
import { mockVim } from "../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

// ---------------------------------------------------------------------------
// Functional completeness benchmarks
// ---------------------------------------------------------------------------

Deno.bench({
  name: "insertCell (code, after anchor) — single operation",
  async fn() {
    const host = mockVim();
    const dispatcher = buildDispatcher(host);
    await dispatcher.open(1, FIXTURE_PATH);
    const anchorId = await dispatcher.lineToCellId(1, 1);
    await dispatcher.insertCell(1, "code", "after", anchorId);
  },
});

Deno.bench({
  name: "deleteCell — single operation on first cell",
  async fn() {
    const host = mockVim();
    const dispatcher = buildDispatcher(host);
    await dispatcher.open(2, FIXTURE_PATH);
    const cellId = await dispatcher.lineToCellId(2, 1);
    if (cellId) {
      await dispatcher.deleteCell(2, cellId);
    }
  },
});

// ---------------------------------------------------------------------------
// O(N) scale sanity — 10, 100, 1000 insert calls per bench run
// ---------------------------------------------------------------------------

for (const n of [10, 100, 1000]) {
  Deno.bench({
    name: `insertCell × ${n} — cumulative throughput`,
    async fn() {
      const host = mockVim();
      const dispatcher = buildDispatcher(host);
      const BUFNR = 100 + n;
      await dispatcher.open(BUFNR, FIXTURE_PATH);
      for (let i = 0; i < n; i++) {
        const anchorId = await dispatcher.lineToCellId(BUFNR, 1);
        await dispatcher.insertCell(BUFNR, "code", "after", anchorId);
      }
    },
  });
}
