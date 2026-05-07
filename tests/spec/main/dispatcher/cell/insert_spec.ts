/**
 * BDD specs for insertCell dispatcher.
 *
 * @spec-id europa.dispatcher.insert-cell
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { buildDispatcher } from "../../../../../denops/europa/main.ts";
import { mockVim } from "../../../../fixtures/mock-host.ts";
import type { MockHost } from "../../../../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../../../../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

let host: MockHost;

// --- insertCell dispatcher (europa.dispatcher.insert-cell) ---

describe("insertCell dispatcher", () => {
  const VIEWER_BUFNR = 42;

  beforeEach(() => {
    host = mockVim();
  });

  it("emits a warning and is a no-op when session is not found", async () => {
    const dispatcher = buildDispatcher(host);
    await dispatcher.insertCell(9999, "code", "after", "some-cell-id");
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "must emit warning on missing session",
    );
  });

  it("does not throw when session is missing", async () => {
    const dispatcher = buildDispatcher(host);
    let threw = false;
    try {
      await dispatcher.insertCell(9999, "code", "after", "some-cell-id");
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  });

  it("updates the notebook and caches a renderPlan after successful insert", async () => {
    const dispatcher = buildDispatcher(host);
    // Open the fixture to create a real session
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    const anchorCellId = "018f1a2b-3c4d-7e5f-6a7b-8c9d0e1f2a3b";
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", anchorCellId);
    // lineToCellId returns non-null only when renderPlan is cached after insert
    const cellId = await dispatcher.lineToCellId(VIEWER_BUFNR, 1);
    assertNotEquals(
      cellId,
      null,
      "renderPlan must be cached after insert so lineToCellId resolves",
    );
  });

  it("emits a warning for invalid cell type", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await dispatcher.insertCell(
      VIEWER_BUFNR,
      "invalid-type",
      "after",
      "some-id",
    );
    const errCmds = host.cmdsMatching("echohl");
    assertEquals(errCmds.length > 0, true, "invalid type must emit warning");
  });
});
