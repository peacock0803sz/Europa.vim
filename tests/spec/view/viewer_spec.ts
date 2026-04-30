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

describe("applyRenderPlan with viewport", () => {
  beforeEach(() => {
    host = mockVim();
  });

  it("renders the viewport slice at topLine+1, not at line 1", async () => {
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
      viewport: { topLine: 50, bottomLine: 60 },
    });
    const writeCall = host.callsTo("setbufline").find((c) => c.args[1] === 1);
    assertEquals(writeCall !== undefined, true);
    assertEquals(writeCall!.args[2], 51, "lnum must be topLine + 1");
    const slice = writeCall!.args[3] as string[];
    assertEquals(slice.length, 11, "slice length is bottomLine - topLine + 1");
    assertEquals(slice[0], "line50");
    assertEquals(slice[10], "line60");
  });

  it("limits the rendered slice to exactly the viewport range", async () => {
    const plan: RenderPlan = {
      lines: ["a", "b", "c", "d", "e"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [{ cellIndex: 0, bufLineStart: 0, bufLineEnd: 4 }],
    };
    await applyRenderPlan(host, 1, plan, {
      viewport: { topLine: 1, bottomLine: 3 },
    });
    const writeCall = host.callsTo("setbufline").find((c) => c.args[1] === 1);
    assertEquals(writeCall!.args[2], 2);
    assertEquals(writeCall!.args[3], ["b", "c", "d"]);
  });

  it("trims residue past plan.lines.length via deletebufline", async () => {
    const plan: RenderPlan = {
      lines: ["a", "b", "c"],
      highlights: [],
      virtText: [],
      imagePlacements: [],
      clickables: [],
      cellMap: [],
    };
    await applyRenderPlan(host, 1, plan);
    const trim = host.callsTo("deletebufline").find((c) =>
      c.args[1] === 1 &&
      c.args[2] === plan.lines.length + 1 &&
      c.args[3] === "$"
    );
    assertEquals(trim !== undefined, true);
  });
});
