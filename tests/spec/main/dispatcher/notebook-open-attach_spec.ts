/**
 * Regression guard: dispatcher.open() must trigger syntax-highlight attach
 * directly, NOT rely on ftplugin's BufRead-time notify.
 *
 * Background: the original T018 design assumed `ftplugin/europa.vim`'s
 * `timer_start(0, ..., 'syntaxHighlightAttach')` would fire after open()
 * populated the session. In practice, RPC handlers run concurrently inside
 * denops; while open() awaits parseNotebook / Deno.readTextFile, the ftplugin
 * notify lands first, sees `sessionStore.get(bn)` → undefined, and silently
 * early-returns at `dispatcher/syntax-highlight.ts:89`. The orchestrator never
 * receives an attach call, `NvimSyntaxHighlighter.init` never runs, and the
 * `Europa-tree-sitter` namespace is never created.
 *
 * Fix: open() schedules its own `scheduleHighlightRefresh` after the session
 * + render-plan are populated, eliminating the race. ftplugin notify remains
 * as a redundant safety net (idempotent on re-paint).
 *
 * @spec-id europa.dispatcher.open-attach-syntax-highlight
 */
import { describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { buildDispatcher } from "../../../../denops/europa/main.ts";
import { mockNvim } from "../../../fixtures/mock-host.ts";

const FIXTURE_PATH = new URL(
  "../../../golden/ipynb/hello.ipynb",
  import.meta.url,
).pathname;

const VIEWER_BUFNR = 700;

function enableTreeSitter(
  host: ReturnType<typeof mockNvim>,
): ReturnType<typeof mockNvim> {
  host.setEval(
    "luaeval('(function() local ok, present = pcall(function() return vim.treesitter ~= nil end); return ok and present end)()')",
    true,
  );
  return host;
}

async function settleFireAndForget(): Promise<void> {
  // scheduleHighlightRefresh is fire-and-forget; allow microtasks to flush.
  await new Promise((r) => setTimeout(r, 30));
}

describe("dispatcher.open — schedules syntax-highlight attach (europa.dispatcher.open-attach-syntax-highlight)", () => {
  it("creates Europa-tree-sitter namespace during open() (no ftplugin needed)", async () => {
    const host = enableTreeSitter(mockNvim());
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;

    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await settleFireAndForget();

    const nsCalls = host.callsTo("nvim_create_namespace").filter((c) =>
      c.args[1] === "Europa-tree-sitter"
    );
    assert(
      nsCalls.length >= 1,
      `expected nvim_create_namespace("Europa-tree-sitter") to be called from open(); got ${nsCalls.length} matching calls`,
    );
  });

  it("dispatches luaeval for cell ranges (highlights actually applied)", async () => {
    const host = enableTreeSitter(mockNvim());
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;

    await dispatcher.open(VIEWER_BUFNR, FIXTURE_PATH);
    await settleFireAndForget();

    const luaCalls = host.callsTo("luaeval");
    assert(
      luaCalls.length >= 1,
      `expected at least one luaeval call from cell highlight application; got ${luaCalls.length}`,
    );
  });
});
