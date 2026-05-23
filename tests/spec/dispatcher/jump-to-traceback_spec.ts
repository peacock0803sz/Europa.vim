/**
 * BDD specs for the `jumpToTraceback` dispatcher RPC (Phase 3.8 US1).
 *
 * Exercises bufexists / bufwinid guards, clickable resolution against
 * the cached RenderPlan, and downstream dispatch to `jumpToCellLine` /
 * `jumpToFile` executors. Headless Neovim integration is out of scope
 * for this spec; behavior on a live host is covered by manual smoke
 * checks listed in `quickstart.md`.
 *
 * @spec-id europa.dispatcher.jump-to-traceback
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { type MockHost, mockNvim } from "../../fixtures/mock-host.ts";
import { SessionStore } from "../../../denops/europa/session/state.ts";
import { ServerPool } from "../../../denops/europa/kernel/server-pool.ts";
import { buildViewDispatcher } from "../../../denops/europa/dispatcher/view.ts";
import type { RenderPlan } from "../../../schema/render-plan.ts";
import type { Notebook } from "../../../schema/notebook.ts";

const cellId = "code-3";

function notebookWithCell(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        cell_type: "code",
        id: cellId,
        source: "a\nb\nc\nd\ne\n",
        execution_count: 3,
        outputs: [],
        metadata: {},
      },
    ],
  };
}

function planForFrame(opts: {
  executionCount?: number;
  line?: number;
  filePath?: string;
}): RenderPlan {
  const clickables: RenderPlan["clickables"] = opts.filePath !== undefined
    ? [
      {
        line: 5,
        colStart: 0,
        colEnd: 24,
        action: {
          type: "jump_to_file",
          payload: { path: opts.filePath, line: opts.line ?? 10 },
        },
      },
    ]
    : [
      {
        line: 5,
        colStart: 0,
        colEnd: 18,
        action: {
          type: "jump_to_cell_line",
          payload: {
            executionCount: opts.executionCount ?? 3,
            line: opts.line ?? 5,
          },
        },
      },
    ];
  return {
    lines: [],
    highlights: [],
    virtText: [],
    imagePlacements: [],
    clickables,
    mdDecorations: [],
    cellMap: [],
    cellRanges: [],
    cellSourceRanges: [
      {
        cellId,
        kind: "code",
        sourceStartLine: 10,
        sourceEndLine: 15,
      },
    ],
  };
}

let host: MockHost;
let sessionStore: SessionStore;

function makeDispatcher() {
  return buildViewDispatcher({
    denops: host,
    sessionStore,
    serverPool: new ServerPool(),
  });
}

function seedSession(bufnr: number, plan: RenderPlan, cwd = "/home/u/proj") {
  sessionStore.add({
    bufnr,
    notebook: notebookWithCell(),
    sourcePath: `/tmp/nb-${bufnr}.ipynb`,
    cellEditBuffers: new Map(),
  } as never);
  sessionStore.setRenderPlan(bufnr, plan);
  // Attach a stub kernelRuntime carrying just the cwd field this RPC reads.
  sessionStore.update(bufnr, {
    kernelRuntime: { cwd } as never,
  });
}

describe("jumpToTraceback dispatcher RPC", () => {
  beforeEach(() => {
    host = mockNvim();
    sessionStore = new SessionStore();
    // Simulate a buffer that exists by registering it in the mock.
    host.bufwinidResult = 1000;
  });
  afterEach(() => {
    // Clean up SessionStore to avoid undo-history leak warnings.
    for (const s of sessionStore.all()) sessionStore.remove(s.bufnr);
  });

  it("throws a command-level error when the viewer buffer does not exist", async () => {
    const d = makeDispatcher();
    await assertRejects(
      () => d.jumpToTraceback(999, 1, 1),
      Error,
      "no active notebook viewer",
    );
  });

  it("warns once when the viewer is hidden, then stays silent on repeat", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    // Make bufexists return true
    await host.call("bufload", bufnr);
    seedSession(bufnr, planForFrame({}));
    host.bufwinidResult = -1; // viewer hidden

    await d.jumpToTraceback(bufnr, 6, 1);
    const warn1 = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("viewer buffer is not visible"),
    );
    assertEquals(warn1 !== undefined, true);
    // callsTo("setbufvar") yields args = ["setbufvar", bn, varName, value]
    const setvar = host.callsTo("setbufvar").find(
      (c) => c.args[2] === "europa_jump_warned" && c.args[3] === 1,
    );
    assertEquals(setvar !== undefined, true);

    // Second call: clear warning calls list to assert nothing new
    const callsBefore = host.calls.length;
    // Pretend the prior setbufvar took effect: getbufvar returns 1
    await host.call("setbufvar", bufnr, "europa_jump_warned", 1);
    await d.jumpToTraceback(bufnr, 6, 1);
    const warn2 = host.calls
      .slice(callsBefore)
      .find(
        (c) =>
          c.method === "cmd" &&
          typeof c.args[0] === "string" &&
          (c.args[0] as string).includes("viewer buffer is not visible"),
      );
    assertEquals(warn2, undefined);
  });

  it("dispatches a jump_to_cell_line action to setpos + normal! zz", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    seedSession(bufnr, planForFrame({ executionCount: 3, line: 5 }));
    // cursor on the frame at fragment-line 5 col 0 → 1-origin (6, 1)
    await d.jumpToTraceback(bufnr, 6, 1);
    // sourceStartLine=10 + K=5 → 15
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes(`setpos('.', [${bufnr}, 15, 1, 0])`),
    );
    assertEquals(setposCmd !== undefined, true);
  });

  it("dispatches a jump_to_file action to a :split + setpos", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    seedSession(bufnr, planForFrame({ filePath: "/abs/foo.py", line: 42 }));
    await d.jumpToTraceback(bufnr, 6, 1);
    const splitCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).startsWith("split "),
    );
    assertEquals(splitCmd !== undefined, true);
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes(
          "setpos('.', [bufnr('%'), 42, 1, 0])",
        ),
    );
    assertEquals(setposCmd !== undefined, true);
    // After the split, the new buffer's window must receive the centering
    // command — without this the user lands at the right line but the
    // viewport may scroll the target line to the screen bottom.
    const zzCmd = host.calls.find(
      (c) => c.method === "cmd" && c.args[0] === "normal! zz",
    );
    assertEquals(zzCmd !== undefined, true);
  });

  it("passes a HOME-expanded path through fnameescape for `~/...` frames", async () => {
    // Override HOME so the assertion is deterministic regardless of the
    // host running the test (CI box, dev laptop, etc.).
    const origHome = Deno.env.get("HOME");
    Deno.env.set("HOME", "/home/u");
    try {
      const d = makeDispatcher();
      const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
      await host.call("bufload", bufnr);
      seedSession(
        bufnr,
        planForFrame({ filePath: "~/x.py", line: 10 }),
        "/home/u/proj",
      );
      await d.jumpToTraceback(bufnr, 6, 1);
      const escape = host.callsTo("fnameescape").find(
        (c) => c.args[1] === "/home/u/x.py",
      );
      assertEquals(escape !== undefined, true);
    } finally {
      if (origHome !== undefined) Deno.env.set("HOME", origHome);
      else Deno.env.delete("HOME");
    }
  });

  it("resolves relative paths against kernelRuntime.cwd before fnameescape", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    seedSession(
      bufnr,
      planForFrame({ filePath: "./util.py", line: 5 }),
      "/home/u/proj",
    );
    await d.jumpToTraceback(bufnr, 6, 1);
    const escape = host.callsTo("fnameescape").find(
      (c) => c.args[1] === "/home/u/proj/util.py",
    );
    assertEquals(escape !== undefined, true);
  });

  it("passes absolute paths to fnameescape as-is (skips cwd resolution)", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    const abs = "/usr/lib/python3.12/json/__init__.py";
    seedSession(
      bufnr,
      planForFrame({ filePath: abs, line: 123 }),
      "/home/u/proj",
    );
    await d.jumpToTraceback(bufnr, 6, 1);
    const escape = host.callsTo("fnameescape").find(
      (c) => c.args[1] === abs,
    );
    assertEquals(escape !== undefined, true);
  });

  it("silently no-ops on jump_to_file when no kernelRuntime is attached", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    // Seed without kernelRuntime — simulates a notebook opened but
    // never executed (no kernel started yet). Without cwd we cannot
    // resolve relative paths, so the executor must bail rather than
    // produce wrong results.
    sessionStore.add({
      bufnr,
      notebook: notebookWithCell(),
      sourcePath: `/tmp/nb-${bufnr}.ipynb`,
      cellEditBuffers: new Map(),
    } as never);
    sessionStore.setRenderPlan(
      bufnr,
      planForFrame({ filePath: "./util.py", line: 5 }),
    );
    await d.jumpToTraceback(bufnr, 6, 1);
    const splitCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).startsWith("split "),
    );
    assertEquals(splitCmd, undefined);
  });

  it("is a silent no-op when the cursor is outside every clickable", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    seedSession(bufnr, planForFrame({ executionCount: 3, line: 5 }));
    // cursor on line 1, col 1 — the frame sits at line 5 (0-origin)
    await d.jumpToTraceback(bufnr, 1, 1);
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });

  it("is a silent no-op when the cell is not actionable (missing execution_count)", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    seedSession(bufnr, planForFrame({ executionCount: 99, line: 1 }));
    await d.jumpToTraceback(bufnr, 6, 1);
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });

  it("is a silent no-op when K is out of the cell's source range", async () => {
    const d = makeDispatcher();
    const bufnr = await host.call("bufadd", "/tmp/nb.ipynb") as number;
    await host.call("bufload", bufnr);
    // sourceEndLine - sourceStartLine = 5 → K=999 is out of range
    seedSession(bufnr, planForFrame({ executionCount: 3, line: 999 }));
    await d.jumpToTraceback(bufnr, 6, 1);
    const setposCmd = host.calls.find(
      (c) =>
        c.method === "cmd" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("setpos"),
    );
    assertEquals(setposCmd, undefined);
  });
});
