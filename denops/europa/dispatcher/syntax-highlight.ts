/**
 * Syntax-highlight dispatcher: attach and refresh RPCs.
 *
 * Translates RPC calls from ftplugin / autocmds into orchestrator operations.
 * Range building reads the cached RenderPlan.cellSourceRanges + notebook
 * metadata so it does not need a separate Neovim round-trip.
 *
 * @module denops/europa/dispatcher/syntax-highlight
 */

import type { EuropaDispatcher } from "../../../contracts/dispatcher.ts";
import type { NotebookMetadata } from "../../../schema/notebook.ts";
import type { CellSourceRange } from "../../../schema/render-plan.ts";
import type { CellLanguageRange } from "../../../schema/highlight.ts";
import { getOrCreateOrchestrator } from "../view/syntax-highlight.ts";
import type { DispatcherContext } from "./context.ts";

/**
 * Build CellLanguageRange[] from cached source ranges + notebook metadata.
 *
 * FR-001 fallback chain: kernelspec.language → language_info.name → "".
 * Markdown cells always use "markdown". Code cells with empty resolved
 * language are included (the Nvim impl will skip them per FR-011).
 */
export function buildCellLangRanges(
  cellSourceRanges: readonly CellSourceRange[],
  metadata: NotebookMetadata,
): CellLanguageRange[] {
  const kernelLang: string = metadata.kernelspec?.language ??
    metadata.language_info?.name ??
    "";

  return cellSourceRanges.map((csr): CellLanguageRange => ({
    kind: csr.kind,
    language: csr.kind === "markdown" ? "markdown" : kernelLang,
    startLine: csr.sourceStartLine,
    endLine: csr.sourceEndLine,
  }));
}

/**
 * Schedule a syntax-highlight refresh for `bufnr` from the current cached plan.
 *
 * Fire-and-forget: errors are silently swallowed so the caller is never
 * blocked or interrupted by highlight failures (FR-006).
 *
 * @spec-id europa.view.syntax-highlight.refresh-on-cell-mutation
 */
export function scheduleHighlightRefresh(
  ctx: DispatcherContext,
  bufnr: number,
): void {
  const { denops, sessionStore } = ctx;
  const session = sessionStore.get(bufnr);
  if (!session) return;
  const plan = sessionStore.getRenderPlan(bufnr);
  const ranges = buildCellLangRanges(
    plan?.cellSourceRanges ?? [],
    session.notebook.metadata,
  );
  const orc = getOrCreateOrchestrator(denops);
  orc.refresh(denops, bufnr, ranges).catch(() => {});
}

/** Build the syntax-highlight sub-dispatcher. */
export function buildSyntaxHighlightDispatcher(
  ctx: DispatcherContext,
): Pick<EuropaDispatcher, "syntaxHighlightAttach" | "syntaxHighlightRefresh"> {
  const { denops, sessionStore } = ctx;

  return {
    /**
     * Initial attach: read cached render plan and apply cell language ranges.
     *
     * Called from ftplugin via timer_start(0, ...) so the first attach is
     * non-blocking (FR-017). If no session or render plan exists yet, no-op.
     *
     * @spec-id europa.dispatcher.syntax-highlight-attach
     * @spec-id europa.ftplugin.attach-on-bufread
     */
    async syntaxHighlightAttach(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 1) return;
      const session = sessionStore.get(bn);
      if (!session) return;
      const plan = sessionStore.getRenderPlan(bn);
      const ranges = buildCellLangRanges(
        plan?.cellSourceRanges ?? [],
        session.notebook.metadata,
      );
      const orc = getOrCreateOrchestrator(denops);
      await orc.attach(denops, bn, ranges);
    },

    /**
     * Refresh: re-read cached ranges and re-apply highlights.
     *
     * Called after any structural mutation that calls setRenderPlan (T019a).
     *
     * @spec-id europa.dispatcher.syntax-highlight-refresh
     */
    async syntaxHighlightRefresh(bufnr: unknown): Promise<void> {
      const bn = Number(bufnr);
      if (!Number.isInteger(bn) || bn < 1) return;
      const session = sessionStore.get(bn);
      if (!session) return;
      const plan = sessionStore.getRenderPlan(bn);
      const ranges = buildCellLangRanges(
        plan?.cellSourceRanges ?? [],
        session.notebook.metadata,
      );
      const orc = getOrCreateOrchestrator(denops);
      await orc.refresh(denops, bn, ranges);
    },
  };
}
