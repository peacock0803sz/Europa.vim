/**
 * SyntaxHighlighter factory and orchestrator skeleton.
 *
 * `createSyntaxHighlighter` returns the host-appropriate implementation
 * (Neovim or Vim), cached by Denops instance (WeakMap).
 *
 * `SyntaxHighlightOrchestrator` wraps the impl and adds config/capability
 * gating. Concrete attach/refresh/detach bodies are wired in T017 (Phase 3).
 *
 * @module denops/europa/view/syntax-highlight
 */

import type { Denops } from "@denops/std";
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

/**
 * Orchestrator: manages HighlightSession per buffer and applies config /
 * capability gating before delegating to the host impl.
 *
 * Concrete `attach` / `refresh` / `detach` bodies are wired in T017 (Phase 3).
 */
export class SyntaxHighlightOrchestrator {
  private readonly _sessions = new Map<number, HighlightSession>();

  constructor(private readonly _impl: SyntaxHighlighter) {}

  async attach(
    denops: Denops,
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    // TODO (T017): add config/capability gating before delegating.
    const session = new HighlightSession(bufnr, ranges);
    this._sessions.set(bufnr, session);
    await this._impl.attach(bufnr, ranges);
    void denops;
  }

  async refresh(
    denops: Denops,
    bufnr: number,
    ranges: readonly CellLanguageRange[],
  ): Promise<void> {
    // TODO (T017): add config/capability gating before delegating.
    const session = this._sessions.get(bufnr);
    if (session) {
      session.ranges = ranges;
    } else {
      this._sessions.set(bufnr, new HighlightSession(bufnr, ranges));
    }
    await this._impl.refresh(bufnr, ranges);
    void denops;
  }

  async detach(denops: Denops, bufnr: number): Promise<void> {
    this._sessions.delete(bufnr);
    await this._impl.detach(bufnr);
    void denops;
  }
}
