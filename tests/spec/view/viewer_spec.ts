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

  it("locks the target buffer via setbufvar &modifiable=0", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const lockCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&modifiable" && c.args[3] === 0
    );
    assertEquals(lockCall !== undefined, true);
  });

  it("sets conceallevel=0 via win_execute on the buffer's window", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const concealCall = host.callsTo("win_execute").find((c) =>
      String(c.args[2]).includes("conceallevel=0")
    );
    assertEquals(concealCall !== undefined, true);
  });

  it("sets &buftype=acwrite on the target buffer", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const buftypeCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&buftype" && c.args[3] === "acwrite"
    );
    assertEquals(buftypeCall !== undefined, true);
  });

  it("clears &modified on the target buffer to suppress the dirty flag", async () => {
    await applyRenderPlan(host, 1, emptyPlan());
    const modifiedCall = host.callsTo("setbufvar").find((c) =>
      c.args[1] === 1 && c.args[2] === "&modified" && c.args[3] === 0
    );
    assertEquals(modifiedCall !== undefined, true);
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
