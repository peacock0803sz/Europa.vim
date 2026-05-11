/**
 * BDD specs for dispatchOutput — MIME priority routing.
 * Also covers renderCellExecState — sign API host abstraction (R05).
 *
 * @spec-id europa.render.dispatcher.mime-priority
 * @spec-id europa.render.cell-exec-state-sign
 */
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  dispatchOutput,
  initCellExecSigns,
  renderCellExecState,
} from "../../../denops/europa/render/dispatcher.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";

const caps: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
  treeSitter: { available: false },
};

const defaultMimePriority = [
  "image/png",
  "image/jpeg",
  "application/json",
  "text/markdown",
  "text/html",
  "text/plain",
];

describe("dispatchOutput", () => {
  it("routes stream outputs directly", () => {
    const out: Output = {
      output_type: "stream",
      name: "stdout",
      text: "hello\n",
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag);
    assertExists(frag.lines);
    assertEquals(frag.lines.some((l: string) => l.includes("hello")), true);
  });

  it("routes error outputs", () => {
    const out: Output = {
      output_type: "error",
      ename: "ValueError",
      evalue: "bad value",
      traceback: ["line1", "line2"],
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("ValueError")),
      true,
    );
  });

  it("selects text/plain from execute_result when highest priority present", () => {
    const out: Output = {
      output_type: "execute_result",
      execution_count: 1,
      data: { "text/plain": "42" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["text/plain"]);
    assertExists(frag.lines);
    assertEquals(frag.lines.some((l: string) => l.includes("42")), true);
  });

  it("selects application/json over text/plain when first in priority", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "application/json": { x: 1 }, "text/plain": "fallback" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["application/json", "text/plain"]);
    assertExists(frag.lines);
    // JSON pretty-printed output should contain the key
    assertEquals(frag.lines.some((l: string) => l.includes("x")), true);
  });

  it("falls back to text/plain when higher-priority MIMEs absent", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "text/plain": "plain only" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("plain only")),
      true,
    );
  });

  it("produces unsupported placeholder for unknown MIME", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "application/vnd.custom": "data" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["application/vnd.custom"]);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("unsupported")),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Sign API host abstraction — renderCellExecState (R05)
// ---------------------------------------------------------------------------

type CallRecord = { fn: string; args: unknown[] };

function makeVimMockDenops(): {
  denops: Record<string, unknown>;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  return {
    denops: {
      meta: {
        host: "vim",
        version: "9.1.1646",
        mode: "release",
        platform: "darwin",
      },
      eval: (_: string) => Promise.resolve(null),
      call: (fn: string, ...args: unknown[]) => {
        calls.push({ fn, args });
        return Promise.resolve(fn === "sign_place" ? 1 : 0);
      },
    },
    calls,
  };
}

function makeNvimMockDenops(): {
  denops: Record<string, unknown>;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  let nextId = 1;
  return {
    denops: {
      meta: {
        host: "nvim",
        version: "0.11.3",
        mode: "release",
        platform: "darwin",
      },
      eval: (_: string) => Promise.resolve(null),
      call: (fn: string, ...args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === "nvim_create_namespace") return Promise.resolve(42);
        if (fn === "nvim_buf_set_extmark") return Promise.resolve(nextId++);
        return Promise.resolve(0);
      },
    },
    calls,
  };
}

describe("initCellExecSigns (Vim host)", () => {
  it("calls sign_define 3 times with EuropaCellBusy / EuropaCellQueued / EuropaCellAborted", async () => {
    const { denops, calls } = makeVimMockDenops();
    await initCellExecSigns(denops as never);
    const defineCalls = calls.filter((c) => c.fn === "sign_define");
    assertEquals(defineCalls.length, 3);
    const names = defineCalls.map((c) => c.args[0]);
    assert(names.includes("EuropaCellBusy"), "missing EuropaCellBusy");
    assert(names.includes("EuropaCellQueued"), "missing EuropaCellQueued");
    assert(names.includes("EuropaCellAborted"), "missing EuropaCellAborted");
  });
});

describe("initCellExecSigns (Neovim host)", () => {
  it("calls nvim_create_namespace to secure the europa_cell_exec namespace", async () => {
    const { denops, calls } = makeNvimMockDenops();
    await initCellExecSigns(denops as never);
    assert(
      calls.some((c) => c.fn === "nvim_create_namespace"),
      "Expected nvim_create_namespace call",
    );
  });
});

describe("renderCellExecState (Vim host)", () => {
  it("state='busy' calls sign_place with EuropaCellBusy", async () => {
    const { denops, calls } = makeVimMockDenops();
    await renderCellExecState(denops as never, 1, "cell-vim-busy", "busy", 5);
    const placeCalls = calls.filter((c) => c.fn === "sign_place");
    assertEquals(placeCalls.length, 1);
    assertEquals(placeCalls[0].args[2], "EuropaCellBusy");
  });

  it("state='queued' calls sign_place with EuropaCellQueued", async () => {
    const { denops, calls } = makeVimMockDenops();
    await renderCellExecState(
      denops as never,
      1,
      "cell-vim-queued",
      "queued",
      10,
    );
    const placeCalls = calls.filter((c) => c.fn === "sign_place");
    assertEquals(placeCalls.length, 1);
    assertEquals(placeCalls[0].args[2], "EuropaCellQueued");
  });

  it("state='aborted' calls sign_place with EuropaCellAborted", async () => {
    const { denops, calls } = makeVimMockDenops();
    await renderCellExecState(
      denops as never,
      1,
      "cell-vim-aborted",
      "aborted",
      15,
    );
    const placeCalls = calls.filter((c) => c.fn === "sign_place");
    assertEquals(placeCalls.length, 1);
    assertEquals(placeCalls[0].args[2], "EuropaCellAborted");
  });

  it("state='idle' calls sign_unplace and no sign_place", async () => {
    const { denops, calls } = makeVimMockDenops();
    await renderCellExecState(denops as never, 1, "cell-vim-idle", "idle");
    assert(
      calls.some((c) => c.fn === "sign_unplace"),
      "Expected sign_unplace call",
    );
    assert(
      !calls.some((c) => c.fn === "sign_place"),
      "Expected no sign_place on idle",
    );
  });
});

describe("renderCellExecState (Neovim host)", () => {
  it("state='busy' calls nvim_buf_set_extmark with sign_text='*'", async () => {
    const { denops, calls } = makeNvimMockDenops();
    await renderCellExecState(denops as never, 2, "cell-nvim-busy", "busy", 5);
    const extmarkCalls = calls.filter((c) => c.fn === "nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length, 1);
    const opts = extmarkCalls[0].args[4] as Record<string, string>;
    assertEquals(opts.sign_text, "*");
  });

  it("state='queued' calls nvim_buf_set_extmark with sign_text='…'", async () => {
    const { denops, calls } = makeNvimMockDenops();
    await renderCellExecState(
      denops as never,
      2,
      "cell-nvim-queued",
      "queued",
      5,
    );
    const extmarkCalls = calls.filter((c) => c.fn === "nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length, 1);
    const opts = extmarkCalls[0].args[4] as Record<string, string>;
    assertEquals(opts.sign_text, "…");
  });

  it("state='aborted' calls nvim_buf_set_extmark with sign_text='!'", async () => {
    const { denops, calls } = makeNvimMockDenops();
    await renderCellExecState(
      denops as never,
      2,
      "cell-nvim-aborted",
      "aborted",
      5,
    );
    const extmarkCalls = calls.filter((c) => c.fn === "nvim_buf_set_extmark");
    assertEquals(extmarkCalls.length, 1);
    const opts = extmarkCalls[0].args[4] as Record<string, string>;
    assertEquals(opts.sign_text, "!");
  });

  it("state='idle' calls nvim_buf_del_extmark after prior placement", async () => {
    const { denops, calls } = makeNvimMockDenops();
    // Place a sign first so idle has something to remove.
    await renderCellExecState(
      denops as never,
      2,
      "cell-nvim-idle-cycle",
      "busy",
      5,
    );
    // Transition to idle.
    await renderCellExecState(
      denops as never,
      2,
      "cell-nvim-idle-cycle",
      "idle",
    );
    assert(
      calls.some((c) => c.fn === "nvim_buf_del_extmark"),
      "Expected nvim_buf_del_extmark call on idle",
    );
  });
});
