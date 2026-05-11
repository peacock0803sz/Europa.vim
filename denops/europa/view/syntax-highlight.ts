/**
 * SyntaxHighlighter factory and orchestrator.
 *
 * `createSyntaxHighlighter` returns the host-appropriate implementation
 * (Neovim or Vim), cached by Denops instance (WeakMap).
 *
 * `SyntaxHighlightOrchestrator` wraps the impl and applies config/capability
 * gating: it reads `ts_highlight` and `treeSitter.available` before each
 * operation, short-circuiting when highlighting should be suppressed (FR-010,
 * FR-014). Sessions are tracked per buffer in a `Map<number, HighlightSession>`.
 *
 * @module denops/europa/view/syntax-highlight
 */

import type { Denops } from "@denops/std";
import { detectCapabilities } from "../capabilities.ts";
import { loadConfig } from "../config.ts";
import type { SyntaxHighlighter } from "../../../contracts/syntax-highlighter.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";
import { NvimSyntaxHighlighter } from "./syntax-highlight-nvim.ts";
import { VimSyntaxHighlighter } from "./syntax-highlight-vim.ts";

export type { CellLanguageRange, SyntaxHighlighter };

// Singleton cache keyed on the Denops instance.
const _cache = new WeakMap<Denops, SyntaxHighlighter>();

/**
 * Return (or create) the SyntaxHighlighter for the given Denops host.
 *
 * Dispatches to `NvimSyntaxHighlighter` on Neovim and `VimSyntaxHighlighter`
 * on Vim, then caches by Denops instance so repeated calls are free.
 *
 * @spec-id europa.view.syntax-highlight.factory
 */
export function createSyntaxHighlighter(host: Denops): SyntaxHighlighter {
  if (_cache.has(host)) return _cache.get(host)!;
  const impl: SyntaxHighlighter = host.meta.host === "nvim"
    ? new NvimSyntaxHighlighter()
    : new VimSyntaxHighlighter();
  _cache.set(host, impl);
  return impl;
}

/**
 * Runtime state for one highlighted buffer.
 * Not schema-ised (pure runtime value, never serialised — data-model.md §4).
 */
class HighlightSession {
  constructor(
    public readonly bufnr: number,
    public ranges: readonly CellLanguageRange[],
  ) {}
}

// Per-Denops-instance orchestrator cache (mirrors the impl cache pattern).
const _orchestratorCache = new WeakMap<Denops, SyntaxHighlightOrchestrator>();

/**
 * Return (or create) the SyntaxHighlightOrchestrator for the given Denops.
 *
 * Lazily creates the orchestrator backed by the host-specific impl from
 * `createSyntaxHighlighter`. Called from `buildSyntaxHighlightDispatcher` and
 * the T019a refresh hooks.
 */
export function getOrCreateOrchestrator(
  denops: Denops,
): SyntaxHighlightOrchestrator {
  if (_orchestratorCache.has(denops)) return _orchestratorCache.get(denops)!;
  const impl = createSyntaxHighlighter(denops);
  const orc = new SyntaxHighlightOrchestrator(impl);
  _orchestratorCache.set(denops, orc);
  return orc;
}

/**
 * Orchestrator: manages HighlightSession per buffer and applies config /
 * capability gating before delegating to the host impl.
 *
 * Gating rules (FR-010 / FR-014):
 * - `ts_highlight === "off"` → no-op for attach and refresh
 * - `ts_highlight === "auto"` and `treeSitter.available === false` → no-op
 * - `ts_highlight === "on"` → always delegate (ignores treeSitter check)
 * - `detach` always propagates regardless of mode (session cleanup is unconditional)
 *
 * The orchestrator owns the impl lifecycle: `_impl.init(denops)` is invoked
 * exactly once on the first attach/refresh that survives the gating check, so
 * that NvimSyntaxHighlighter can lazily allocate its namespace and capture
 * the Denops handle. This is required because `createSyntaxHighlighter` is a
 * sync factory and can't run async init at construction time.
 *
 * @spec-id europa.view.syntax-highlight.orchestrator-gating
 * @spec-id europa.view.syntax-highlight.orchestrator-init-lazy
 */
export class SyntaxHighlightOrchestrator {
  private readonly _sessions = new Map<number, HighlightSession>();
  private _initPromise?: Promise<void>;

  constructor(private readonly _impl: SyntaxHighlighter) {}

  async attach(
    denops: Denops,
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    if (!await this._shouldHighlight(denops)) return;
    await this._ensureInit(denops);
    const session = new HighlightSession(bufnr, ranges);
    this._sessions.set(bufnr, session);
    await this._impl.attach(bufnr, ranges);
  }

  async refresh(
    denops: Denops,
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    if (!await this._shouldHighlight(denops)) return;
    await this._ensureInit(denops);
    const session = this._sessions.get(bufnr);
    if (session) {
      session.ranges = ranges;
    } else {
      this._sessions.set(bufnr, new HighlightSession(bufnr, ranges));
    }
    await this._impl.refresh(bufnr, ranges);
  }

  async detach(denops: Denops, bufnr: number): Promise<void> {
    this._sessions.delete(bufnr);
    await this._impl.detach(bufnr);
    void denops;
  }

  /**
   * Determine whether highlighting should proceed based on config + capabilities.
   *
   * Returns `false` when mode is "off" or when mode is "auto" and tree-sitter
   * is not available on the current host.
   */
  private async _shouldHighlight(denops: Denops): Promise<boolean> {
    const config = await loadConfig(denops);
    if (config.ts_highlight === "off") return false;
    if (config.ts_highlight === "on") return true;
    // "auto": check host capability
    const caps = await detectCapabilities(denops);
    return caps.treeSitter.available;
  }

  /**
   * Run `_impl.init(denops)` exactly once. The Promise is cached so concurrent
   * attach/refresh callers all await the same init result without re-entering.
   */
  private _ensureInit(denops: Denops): Promise<void> {
    if (!this._initPromise) {
      this._initPromise = this._impl.init(denops);
    }
    return this._initPromise;
  }
}
