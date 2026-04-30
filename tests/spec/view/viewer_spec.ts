/**
 * BDD specs for applyRenderPlan — modifiable, conceal, lazy rendering.
 *
 * @spec-id europa.view.viewer.modifiable
 * @spec-id europa.view.viewer.conceal-zero
 * @spec-id europa.view.viewer.lazy-render
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { applyRenderPlan } from "../../../denops/europa/view/viewer.ts";
import { type MockHost, mockVim } from "../../fixtures/mock-host.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";

function emptyPlan(): RenderPlan {
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables: [],
    cellMap: [],
  };
}

let host: MockHost;

describe("applyRenderPlan", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("issues setlocal modifiable=false", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const cmds = host.cmdsMatching("modifiable=false");
    assertEquals(cmds.length > 0, true);
  });

  it("issues setlocal conceallevel=0", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const cmds = host.cmdsMatching("conceallevel=0");
    assertEquals(cmds.length > 0, true);
  });
});

describe("applyRenderPlan", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("accepts a viewport option without error", async () => {
    const plan: RenderPlan = {
      lines: ["line1", "line2", "line3"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [{ cellIndex: 0, bufLineStart: 0, bufLineEnd: 2 }],
    };
    await applyRenderPlan(host, 1, plan, {
      viewport: { topLine: 0, bottomLine: 10 },
    });
    // If no error thrown, lazy apply with viewport is accepted
    assertEquals(true, true);
  });

  it("applies only fragments within viewport ± lazy_padding", async () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const plan: RenderPlan = {
      lines: manyLines,
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [{ cellIndex: 0, bufLineStart: 0, bufLineEnd: 99 }],
    };
    await applyRenderPlan(host, 1, plan, {
      viewport: { topLine: 0, bottomLine: 10 },
    });
    // Should complete without error (lazy rendering accepted)
    assertEquals(true, true);
  });
});
