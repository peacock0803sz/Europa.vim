/**
 * Performance specs for the undo/redo system (SC-001, SC-002, SC-003).
 *
 * Uses performance.now() wall-clock deltas and Deno.memoryUsage().rss
 * for SC-003 memory checks (no external bench framework needed).
 *
 * Budget overrides via env:
 *   EUROPA_PERF_BUDGET_MS    — override per-op ms budget (default 300)
 *   EUROPA_PERF_BUDGET_RSS_MB — override RSS delta budget in MB (default 200)
 */

import { describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { createUndoHistory } from "../../../denops/europa/session/undo-history.ts";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { UndoEntry } from "../../../contracts/undo-history.ts";

const BUDGET_MS = Number(Deno.env.get("EUROPA_PERF_BUDGET_MS") ?? "300");
const BUDGET_RSS_MB = Number(
  Deno.env.get("EUROPA_PERF_BUDGET_RSS_MB") ?? "200",
);

const FIXTURE_PATH = new URL(
  "../../golden/ipynb/hello.ipynb",
  import.meta.url,
).pathname;

function makeEntry(): UndoEntry {
  return {
    opType: "insertCell",
    snapshot: { metadata: {}, cells: [] },
    beforeHint: { kind: "single", cellId: "cell-a" },
    afterHint: { kind: "single", cellId: "cell-a" },
  };
}

function drain(): Promise<void> {
  // setTimeout(0) fires after all pending microtasks are flushed, which is
  // sufficient since mockVim resolves every denops.call() synchronously.
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// SC-001: 1 mutation → 1 undo ≤ BUDGET_MS (T039a)
// ---------------------------------------------------------------------------

describe("performance: SC-001 — single undo ≤ 300ms per operation", () => {
  it(`one mutation + europaUndo completes within ${BUDGET_MS}ms`, async () => {
    const host = mockVim();
    const d = buildDispatcher(host);
    await d.open(1, FIXTURE_PATH);
    const cellId = (await d.lineToCellId(1, 1)) as string;

    await d.insertCell(1, "code", "after", cellId);

    const start = performance.now();
    await d.europaUndo(1);
    await drain();
    const elapsed = performance.now() - start;

    assert(
      elapsed < BUDGET_MS,
      `SC-001: undo took ${elapsed.toFixed(1)}ms, budget is ${BUDGET_MS}ms`,
    );
  });
});

// ---------------------------------------------------------------------------
// SC-002: 50 mutations → 50 undos total ≤ 15 000ms (T039b)
// ---------------------------------------------------------------------------

describe("performance: SC-002 — 50 undo operations within 15 seconds", () => {
  it(`50 mutations + 50 europaUndo calls complete within 15 000ms`, async () => {
    const BUDGET_TOTAL_MS = 15_000;
    const host = mockVim();
    const d = buildDispatcher(host);
    await d.open(2, FIXTURE_PATH);
    const cellId = (await d.lineToCellId(2, 1)) as string;

    for (let i = 0; i < 50; i++) {
      await d.insertCell(2, "code", "after", cellId);
    }

    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      await d.europaUndo(2);
      await drain();
    }
    const elapsed = performance.now() - start;

    assert(
      elapsed < BUDGET_TOTAL_MS,
      `SC-002: 50 undos took ${
        elapsed.toFixed(0)
      }ms, budget is ${BUDGET_TOTAL_MS}ms`,
    );
  });
});

// ---------------------------------------------------------------------------
// SC-003: 200 pushes, RSS delta ≤ BUDGET_RSS_MB (T039c)
// ---------------------------------------------------------------------------

describe("performance: SC-003 — 200 undo entries do not grow RSS by > 200 MB", () => {
  it(`200 push() calls increase RSS by less than ${BUDGET_RSS_MB} MB`, () => {
    // Allow GC before measurement
    (globalThis as { gc?: () => void }).gc?.();
    const rssBefore = Deno.memoryUsage().rss;

    const h = createUndoHistory(200);
    for (let i = 0; i < 200; i++) {
      h.push(makeEntry());
    }

    (globalThis as { gc?: () => void }).gc?.();
    const rssAfter = Deno.memoryUsage().rss;
    const deltaMB = (rssAfter - rssBefore) / (1024 * 1024);

    assert(
      deltaMB < BUDGET_RSS_MB,
      `SC-003: RSS grew by ${
        deltaMB.toFixed(1)
      } MB, budget is ${BUDGET_RSS_MB} MB`,
    );
  });
});
