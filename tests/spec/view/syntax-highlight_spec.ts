/**
 * BDD specs for the Europa syntax-highlight layer.
 *
 * Covers: FR-001/FR-007/FR-011/FR-012/FR-014/FR-015/FR-016/FR-017/SC-007/SC-009
 *
 * @spec-id europa.view.syntax-highlight.vim-noop
 * @spec-id europa.view.syntax-highlight.factory
 * @spec-id europa.view.syntax-highlight.nvim-attach
 * @spec-id europa.view.syntax-highlight.nvim-refresh
 * @spec-id europa.view.syntax-highlight.lazy-visible-first
 * @spec-id europa.view.syntax-highlight.orchestrator-gating
 * @spec-id europa.view.syntax-highlight.refresh-on-cell-mutation
 * @spec-id europa.view.syntax-highlight.markdown-cell
 * @spec-id europa.view.syntax-highlight.markdown-fence-injection
 * @spec-id europa.view.syntax-highlight.markdown-attach
 * @spec-id europa.view.syntax-highlight.parser-missing
 * @spec-id europa.view.syntax-highlight.language-unknown
 * @spec-id europa.view.syntax-highlight.vim-host-fallback
 * @spec-id europa.view.syntax-highlight.language-fallback-chain
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { mockNvim, mockVim } from "../../fixtures/mock-host.ts";
import type { Denops } from "@denops/std";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";
import {
  createSyntaxHighlighter,
  SyntaxHighlightOrchestrator,
} from "../../../denops/europa/view/syntax-highlight.ts";
import { VimSyntaxHighlighter } from "../../../denops/europa/view/syntax-highlight-vim.ts";
import { NvimSyntaxHighlighter } from "../../../denops/europa/view/syntax-highlight-nvim.ts";
import { buildCellLangRanges } from "../../../denops/europa/dispatcher/syntax-highlight.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PYTHON_RANGE: CellLanguageRange = {
  kind: "code",
  language: "python",
  startLine: 1,
  endLine: 5,
};

const EMPTY_LANG_RANGE: CellLanguageRange = {
  kind: "code",
  language: "",
  startLine: 1,
  endLine: 5,
};

/** Minimal SyntaxHighlighter mock for orchestrator gating tests. */
class SpyHighlighter implements SyntaxHighlighter {
  initCount = 0;
  attachCount = 0;
  refreshCount = 0;
  detachCount = 0;

  init(_d: Denops): Promise<void> {
    this.initCount++;
    return Promise.resolve();
  }
  attach(_bufnr: number, _ranges: readonly CellLanguageRange[]): Promise<void> {
    this.attachCount++;
    return Promise.resolve();
  }
  refresh(
    _bufnr: number,
    _ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    this.refreshCount++;
    return Promise.resolve();
  }
  detach(_bufnr: number): Promise<void> {
    this.detachCount++;
    return Promise.resolve();
  }
}

describe("VimSyntaxHighlighter — no-op (europa.view.syntax-highlight.vim-noop)", () => {
  it("init resolves without throwing", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.init(denops);
    assertEquals(denops.calls.length, 0);
  });

  it("attach resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.attach(1, []);
    assertEquals(denops.calls.length, 0);
  });

  it("refresh resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.refresh(1, []);
    assertEquals(denops.calls.length, 0);
  });

  it("detach resolves without throwing and makes no host calls", async () => {
    const denops = mockVim();
    const hl = new VimSyntaxHighlighter();
    await hl.detach(1);
    assertEquals(denops.calls.length, 0);
  });
});

describe("createSyntaxHighlighter factory (europa.view.syntax-highlight.factory)", () => {
  it("returns VimSyntaxHighlighter for Vim host", () => {
    const denops = mockVim();
    const hl = createSyntaxHighlighter(denops);
    assertEquals(hl instanceof VimSyntaxHighlighter, true);
  });

  it("returns NvimSyntaxHighlighter for Neovim host", () => {
    const denops = mockNvim();
    const hl = createSyntaxHighlighter(denops);
    assertEquals(hl instanceof NvimSyntaxHighlighter, true);
  });

  it("returns the same instance on repeated calls (WeakMap cache)", () => {
    const denops = mockVim();
    const hl1 = createSyntaxHighlighter(denops);
    const hl2 = createSyntaxHighlighter(denops);
    assertEquals(hl1 === hl2, true);
  });
});

// ---------------------------------------------------------------------------
// NvimSyntaxHighlighter — candidate β implementation (T016)
// ---------------------------------------------------------------------------

describe("NvimSyntaxHighlighter — init creates namespace (europa.view.syntax-highlight.nvim-attach)", () => {
  it("calls nvim_create_namespace during init", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    const nsCalls = denops.callsTo("nvim_create_namespace");
    assertEquals(nsCalls.length >= 1, true);
  });
});

describe("NvimSyntaxHighlighter — attach (europa.view.syntax-highlight.nvim-attach)", () => {
  it("calls luaeval for a non-empty language range (FR-001)", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    await hl.attach(1, [PYTHON_RANGE]);
    const execLua = denops.callsTo("luaeval");
    assertEquals(
      execLua.length >= 1,
      true,
      "expected at least one luaeval call",
    );
  });

  it("skips cells with empty language without calling luaeval (FR-011)", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    await hl.attach(1, [EMPTY_LANG_RANGE]);
    const execLua = denops.callsTo("luaeval");
    assertEquals(
      execLua.length,
      0,
      "should not call luaeval for empty language",
    );
  });

  it("does not throw when parser load fails (FR-006 — per-cell silent skip)", async () => {
    const denops = mockNvim();
    // luaeval returns null (simulating Lua pcall failure) — must not throw
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    await hl.attach(1, [PYTHON_RANGE]);
    // If we reach here, no exception was thrown
    assertEquals(true, true);
  });

  it("Europa* highlight link targets are unchanged after attach (SC-007)", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    // Record which hi commands init issued
    const hiBeforeAttach = denops.cmdsMatching("hi default link").length;
    await hl.attach(1, [PYTHON_RANGE]);
    // attach should not issue any new hi commands (SC-007: no regression on border groups)
    const hiAfterAttach = denops.cmdsMatching("hi default link").length;
    assertEquals(
      hiAfterAttach,
      hiBeforeAttach,
      "attach must not modify highlight group links",
    );
  });
});

describe("NvimSyntaxHighlighter — refresh (europa.view.syntax-highlight.nvim-refresh)", () => {
  it("calls nvim_buf_clear_namespace before re-applying highlights", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    await hl.refresh(1, [PYTHON_RANGE]);
    const clearCalls = denops.callsTo("nvim_buf_clear_namespace");
    assertEquals(
      clearCalls.length >= 1,
      true,
      "refresh must clear namespace first",
    );
    const execLua = denops.callsTo("luaeval");
    assertEquals(execLua.length >= 1, true, "refresh must re-apply highlights");
  });
});

describe("NvimSyntaxHighlighter — lazy visible-first (europa.view.syntax-highlight.lazy-visible-first)", () => {
  it("only highlights the ranges passed to attach (SC-009: caller controls visibility)", async () => {
    const denops = mockNvim();
    const hl = new NvimSyntaxHighlighter();
    await hl.init(denops);
    // Pass only 1 of 3 cells (simulating visible-only subset)
    const visibleRange: CellLanguageRange = {
      kind: "code",
      language: "python",
      startLine: 10,
      endLine: 15,
    };
    await hl.attach(1, [visibleRange]);
    const execLua = denops.callsTo("luaeval");
    // Exactly one luaeval call for exactly one visible range
    assertEquals(execLua.length, 1);
  });
});

// ---------------------------------------------------------------------------
// SyntaxHighlightOrchestrator — config/capability gating (T017)
// ---------------------------------------------------------------------------

describe("SyntaxHighlightOrchestrator — gating (europa.view.syntax-highlight.orchestrator-gating)", () => {
  it("short-circuits when ts_highlight is 'off', impl.attach NOT called (FR-010)", async () => {
    const denops = mockNvim();
    denops.setEval(`get(g:, 'europa_ts_highlight', "auto")`, "off");
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(spy.attachCount, 0, "attach must not be called when mode=off");
  });

  it("short-circuits when mode is 'auto' and treeSitter is unavailable (FR-014)", async () => {
    const denops = mockNvim();
    // ts_highlight defaults to "auto", luaeval for treeSitter probe returns null → false
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(
      spy.attachCount,
      0,
      "attach must not be called when auto+no treeSitter",
    );
  });

  it("delegates to impl when mode is 'on' regardless of treeSitter (FR-010)", async () => {
    const denops = mockNvim();
    denops.setEval(`get(g:, 'europa_ts_highlight', "auto")`, "on");
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(spy.attachCount, 1, "attach must be called when mode=on");
  });

  it("delegates to impl when mode is 'auto' and treeSitter IS available", async () => {
    const denops = mockNvim();
    // ts_highlight=auto (default), treeSitter=true
    denops.setEval(
      "luaeval('(function() local ok, present = pcall(function() return vim.treesitter ~= nil end); return ok and present end)()')",
      true,
    );
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(
      spy.attachCount,
      1,
      "attach must be called when auto+treeSitter available",
    );
  });

  it("refresh short-circuits when mode is 'off'", async () => {
    const denops = mockNvim();
    denops.setEval(`get(g:, 'europa_ts_highlight', "auto")`, "off");
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.refresh(denops, 1, [PYTHON_RANGE]);
    assertEquals(
      spy.refreshCount,
      0,
      "refresh must not be called when mode=off",
    );
  });

  it("detach always cleans up session regardless of mode", async () => {
    const denops = mockNvim();
    denops.setEval(`get(g:, 'europa_ts_highlight', "auto")`, "off");
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.detach(denops, 1);
    // detach should always propagate (session cleanup is unconditional)
    assertEquals(spy.detachCount, 1, "detach must always propagate");
  });
});

// ---------------------------------------------------------------------------
// SyntaxHighlightOrchestrator — lazy init guard
// ---------------------------------------------------------------------------

/**
 * Regression guard: ftplugin → syntaxHighlightAttach → orchestrator.attach
 * must call `_impl.init(denops)` exactly once before the first delegated
 * attach/refresh. Previously the orchestrator skipped init entirely, so
 * NvimSyntaxHighlighter's `_host`/`_nsId` stayed undefined and the in-Lua
 * highlight pipeline was silently no-op'd at runtime (T038 bug).
 *
 * @spec-id europa.view.syntax-highlight.orchestrator-init-lazy
 */
describe("SyntaxHighlightOrchestrator — lazy init (europa.view.syntax-highlight.orchestrator-init-lazy)", () => {
  function nvimWithTreeSitter() {
    const denops = mockNvim();
    denops.setEval(
      "luaeval('(function() local ok, present = pcall(function() return vim.treesitter ~= nil end); return ok and present end)()')",
      true,
    );
    return denops;
  }

  it("calls _impl.init exactly once on first attach", async () => {
    const denops = nvimWithTreeSitter();
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(spy.initCount, 1, "init must run before first attach");
    assertEquals(spy.attachCount, 1, "attach must still be delegated");
  });

  it("does not re-init on subsequent attach/refresh calls", async () => {
    const denops = nvimWithTreeSitter();
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    await orc.attach(denops, 2, [PYTHON_RANGE]);
    await orc.refresh(denops, 1, [PYTHON_RANGE]);
    assertEquals(spy.initCount, 1, "init must run only once across calls");
  });

  it("does NOT init when ts_highlight is 'off' (gating beats init)", async () => {
    const denops = mockNvim();
    denops.setEval(`get(g:, 'europa_ts_highlight', "auto")`, "off");
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.attach(denops, 1, [PYTHON_RANGE]);
    assertEquals(spy.initCount, 0, "init must be skipped when mode=off");
  });

  it("detach alone does not trigger init", async () => {
    const denops = nvimWithTreeSitter();
    const spy = new SpyHighlighter();
    const orc = new SyntaxHighlightOrchestrator(spy);
    await orc.detach(denops, 1);
    assertEquals(spy.initCount, 0, "detach must not trigger lazy init");
    assertEquals(spy.detachCount, 1, "detach must still propagate");
  });
});

// ---------------------------------------------------------------------------
// buildCellLangRanges — FR-001 language resolution (T019a)
// ---------------------------------------------------------------------------

describe("buildCellLangRanges — FR-001 language resolution (europa.view.syntax-highlight.refresh-on-cell-mutation)", () => {
  it("uses kernelspec.language for code cells", () => {
    const ranges = buildCellLangRanges(
      [{ cellId: "a", kind: "code", sourceStartLine: 1, sourceEndLine: 5 }],
      { kernelspec: { language: "python" } },
    );
    assertEquals(ranges[0].language, "python");
    assertEquals(ranges[0].kind, "code");
    assertEquals(ranges[0].startLine, 1);
    assertEquals(ranges[0].endLine, 5);
  });

  it("falls back to language_info.name when kernelspec.language is absent", () => {
    const ranges = buildCellLangRanges(
      [{ cellId: "a", kind: "code", sourceStartLine: 0, sourceEndLine: 3 }],
      { language_info: { name: "julia" } },
    );
    assertEquals(ranges[0].language, "julia");
  });

  it("resolves to empty string when no language metadata available (FR-011 trigger)", () => {
    const ranges = buildCellLangRanges(
      [{ cellId: "a", kind: "code", sourceStartLine: 0, sourceEndLine: 3 }],
      {},
    );
    assertEquals(ranges[0].language, "");
  });

  it("always uses 'markdown' for markdown cells regardless of kernel language", () => {
    const ranges = buildCellLangRanges(
      [{
        cellId: "b",
        kind: "markdown",
        sourceStartLine: 6,
        sourceEndLine: 10,
      }],
      { kernelspec: { language: "python" } },
    );
    assertEquals(ranges[0].language, "markdown");
    assertEquals(ranges[0].kind, "markdown");
  });

  it("handles mixed code + markdown cells in one notebook", () => {
    const result = buildCellLangRanges(
      [
        { cellId: "c1", kind: "code", sourceStartLine: 1, sourceEndLine: 5 },
        {
          cellId: "c2",
          kind: "markdown",
          sourceStartLine: 6,
          sourceEndLine: 9,
        },
        { cellId: "c3", kind: "code", sourceStartLine: 10, sourceEndLine: 14 },
      ],
      { kernelspec: { language: "python" } },
    );
    assertEquals(result[0].language, "python");
    assertEquals(result[1].language, "markdown");
    assertEquals(result[2].language, "python");
  });
});

// ---------------------------------------------------------------------------
// Phase 4: User Story 2 — Markdown cell highlighting
// ---------------------------------------------------------------------------

describe("buildCellLangRanges — markdown cell (europa.view.syntax-highlight.markdown-cell)", () => {
  it("emits kind:markdown language:markdown for markdown source ranges", () => {
    const ranges = buildCellLangRanges(
      [{
        cellId: "m1",
        kind: "markdown",
        sourceStartLine: 0,
        sourceEndLine: 8,
      }],
      { kernelspec: { language: "python" } },
    );
    assertEquals(ranges[0].kind, "markdown");
    assertEquals(ranges[0].language, "markdown");
    assertEquals(ranges[0].startLine, 0);
    assertEquals(ranges[0].endLine, 8);
  });

  it("markdown cells always use 'markdown' regardless of kernel language", () => {
    const ranges = buildCellLangRanges(
      [{
        cellId: "m2",
        kind: "markdown",
        sourceStartLine: 5,
        sourceEndLine: 12,
      }],
      {},
    );
    assertEquals(ranges[0].language, "markdown");
  });
});

describe(
  "NvimSyntaxHighlighter — markdown fence injection (europa.view.syntax-highlight.markdown-fence-injection)",
  () => {
    it("calls luaeval for markdown cell with 'markdown' language (SC-006)", async () => {
      const denops = mockNvim();
      const hl = new NvimSyntaxHighlighter();
      await hl.init(denops);
      await hl.attach(1, [
        { kind: "markdown", language: "markdown", startLine: 0, endLine: 10 },
      ]);
      const execLua = denops.callsTo("luaeval");
      assertEquals(
        execLua.length >= 1,
        true,
        "expected luaeval for markdown cell",
      );
    });

    it("markdown attach does not throw even if parser unavailable (FR-006)", async () => {
      const denops = mockNvim();
      const hl = new NvimSyntaxHighlighter();
      await hl.init(denops);
      await hl.attach(1, [
        { kind: "markdown", language: "markdown", startLine: 0, endLine: 10 },
      ]);
      assertEquals(true, true); // no throw
    });
  },
);

// ---------------------------------------------------------------------------
// Phase 5: User Story 3 — Graceful degradation
// ---------------------------------------------------------------------------

describe(
  "NvimSyntaxHighlighter — parser missing (europa.view.syntax-highlight.parser-missing)",
  () => {
    it("does not throw when parser is unavailable for an unknown language (FR-006)", async () => {
      const denops = mockNvim();
      const hl = new NvimSyntaxHighlighter();
      await hl.init(denops);
      await hl.attach(1, [
        { kind: "code", language: "haskell", startLine: 0, endLine: 5 },
      ]);
      assertEquals(true, true); // no throw
    });

    it("continues highlighting remaining cells after one fails (per-cell isolation)", async () => {
      const denops = mockNvim();
      const hl = new NvimSyntaxHighlighter();
      await hl.init(denops);
      // Two ranges: one unknown, one valid
      await hl.attach(1, [
        { kind: "code", language: "haskell", startLine: 0, endLine: 5 },
        { kind: "code", language: "python", startLine: 6, endLine: 10 },
      ]);
      // Both cells attempt luaeval (mock returns null for both)
      const calls = denops.callsTo("luaeval");
      assertEquals(calls.length, 2, "both cells should attempt highlighting");
    });
  },
);

describe(
  "buildCellLangRanges — language unknown (europa.view.syntax-highlight.language-unknown)",
  () => {
    it("resolves to empty string when metadata has no kernelspec (FR-011 trigger)", () => {
      const ranges = buildCellLangRanges(
        [{ cellId: "c1", kind: "code", sourceStartLine: 0, sourceEndLine: 5 }],
        {},
      );
      assertEquals(ranges[0].language, "");
    });

    it("resolves to empty string when kernelspec has no language field", () => {
      const ranges = buildCellLangRanges(
        [{ cellId: "c1", kind: "code", sourceStartLine: 0, sourceEndLine: 5 }],
        { kernelspec: { display_name: "Python 3", name: "python3" } },
      );
      assertEquals(ranges[0].language, "");
    });
  },
);

describe(
  "VimSyntaxHighlighter — Vim host fallback (europa.view.syntax-highlight.vim-host-fallback)",
  () => {
    it("attach with any language is a no-op on Vim host (SC-008)", async () => {
      const denops = mockVim();
      const hl = new VimSyntaxHighlighter();
      await hl.attach(1, [
        { kind: "code", language: "haskell", startLine: 0, endLine: 5 },
      ]);
      assertEquals(denops.calls.length, 0);
    });

    it("refresh with any language is a no-op on Vim host", async () => {
      const denops = mockVim();
      const hl = new VimSyntaxHighlighter();
      await hl.refresh(1, [
        { kind: "code", language: "python", startLine: 0, endLine: 5 },
      ]);
      assertEquals(denops.calls.length, 0);
    });
  },
);

describe(
  "buildCellLangRanges — language fallback chain (europa.view.syntax-highlight.language-fallback-chain)",
  () => {
    it("uses kernelspec.language as first priority", () => {
      const ranges = buildCellLangRanges(
        [{ cellId: "c1", kind: "code", sourceStartLine: 0, sourceEndLine: 3 }],
        {
          kernelspec: { language: "julia" },
          language_info: { name: "python" },
        },
      );
      assertEquals(
        ranges[0].language,
        "julia",
        "kernelspec.language wins over language_info",
      );
    });

    it("falls back to language_info.name when kernelspec.language absent", () => {
      const ranges = buildCellLangRanges(
        [{ cellId: "c1", kind: "code", sourceStartLine: 0, sourceEndLine: 3 }],
        { kernelspec: { name: "python3" }, language_info: { name: "python" } },
      );
      assertEquals(ranges[0].language, "python");
    });

    it("resolves to empty string as final fallback (plain text, FR-011)", () => {
      const ranges = buildCellLangRanges(
        [{ cellId: "c1", kind: "code", sourceStartLine: 0, sourceEndLine: 3 }],
        {},
      );
      assertEquals(ranges[0].language, "");
    });
  },
);
