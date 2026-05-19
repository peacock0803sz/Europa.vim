/**
 * Hand-written contract for the Markdown inline renderer (Phase 3.7).
 *
 * Authorized by SoT separation policy (DESIGN.md §3.5 / §3.7):
 * - `MdDecorationSchema` is defined as a TypeBox object schema in
 *   `schema/render-plan.ts` (extends the existing render-plan SoT).
 * - This file declares the runtime contract — function signatures and
 *   side-effect boundaries — that cannot be expressed as TypeBox alone.
 *
 * @module contracts/markdown-renderer
 * @spec-id europa.render.markdown.heading-only
 * @spec-id europa.render.markdown.inline-decoration
 * @spec-id europa.render.markdown.viewport-gating
 * @spec-id europa.render.markdown.cursor-line-conceal
 */

import type { Static } from "@sinclair/typebox";
import {
  MdDecorationSchema,
  RenderFragmentSchema,
} from "../schema/render-plan.ts";

/**
 * A single overlay decoration produced by `renderMarkdown`.
 *
 * Each decoration corresponds to either a `conceal` range (to hide markdown
 * sigil characters such as `**` / `[](url)`), a `virtText` overlay (e.g., the
 * code-fence language tag), an `hlGroup` highlight applied to the underlying
 * range, or any combination of the three.
 *
 * @spec-id europa.render.markdown.inline-decoration
 */
export type MdDecoration = Static<typeof MdDecorationSchema>;

/**
 * Render fragment produced by `renderMarkdown` (and extended for all
 * `RenderFragment`-producing renderers — see `schema/render-plan.ts`).
 *
 * `mdDecorations` is **always present** (defaults to `[]` for non-markdown
 * renderers) so that callers can flatten without `?? []` plumbing.
 *
 * @spec-id europa.render.markdown.inline-decoration
 */
export type MarkdownRenderFragment = Static<typeof RenderFragmentSchema>;

/**
 * Markdown source → render fragment.
 *
 * Phase 2 behaviour (= `EuropaCellMarkdown` highlight on `^#{1,6} ` heading
 * lines, `@spec-id europa.render.markdown.heading-only`) is preserved
 * unconditionally. Phase 3.7 adds `mdDecorations` covering GFM core subset:
 *
 * - Bold (`**text**` / `__text__`)              — conceal `*`/`_` + `EuropaMdBold`
 * - Italic (`*text*` / `_text_`)                — conceal `*`/`_` + `EuropaMdItalic`
 * - Inline code (`` `code` ``)                   — conceal backticks + `EuropaMdCode`
 * - Link (`[text](url)`) + autolink (`<url>`)   — conceal brackets/URL + `EuropaMdLink`
 * - Image (`![alt](path)`)                       — conceal brackets/path + `EuropaMdLink`
 * - Unordered list (`-`, `*`, `+`)              — `EuropaMdListMarker`
 * - Ordered list (`1.`)                          — `EuropaMdListMarker`
 * - Blockquote (`>`)                             — `EuropaMdQuote` (hl_eol)
 * - Horizontal rule (`---`, `***`, `___`)        — `EuropaMdRule` (hl_eol)
 * - Strikethrough (`~~text~~`)                   — conceal `~~` + `EuropaMdStrike`
 * - Code fence boundary (` ``` `)                — conceal triplet + lang tag virt_text
 *
 * **Failure mode**: when `marked.Lexer.lex(source)` throws (= malformed
 * markdown that escapes the lexer's own recovery), the returned fragment
 * contains only the Phase 2 heading highlights (`mdDecorations` is `[]`).
 * The exception is logged at debug level *once* per process and never
 * surfaces to the user — there is no session-level warning (FR-003).
 *
 * **Synchronous contract**: `renderMarkdown` MUST NOT perform I/O. It is a
 * pure data transform that takes `O(N · M)` time for source length N and
 * token count M (R8 reverse-locate strategy). Render layer §3.7.5 invariant.
 *
 * @param source - Raw markdown source as a single string (LF-joined). Source
 *                 normalisation from nbformat `string | string[]` happens
 *                 upstream in `notebook/parse.ts` (R6).
 * @returns A `MarkdownRenderFragment` whose `mdDecorations` is non-empty on
 *          success (or `[]` on malformed source).
 * @spec-id europa.render.markdown.heading-only
 * @spec-id europa.render.markdown.inline-decoration
 */
export type RenderMarkdown = (source: string) => MarkdownRenderFragment;

/**
 * Inclusive 1-origin line range describing the current viewport plus
 * `LAZY_PADDING = 10` (md-render.nvim convention, DESIGN.md §11.8).
 *
 * Stored as module-private state inside `view/viewer.ts`. Updated by the
 * `WinScrolled` autocmd hook.
 *
 * @spec-id europa.render.markdown.viewport-gating
 */
export type MdOverlayViewport = {
  /** 1-origin top visible line (Vim `line('w0')`). */
  top: number;
  /** 1-origin bottom visible line (Vim `line('w$')`). */
  bottom: number;
};

/**
 * Apply a subset of `mdDecorations` to the Neovim buffer via
 * `nvim_buf_set_extmark`, registering the returned extmark ids in the
 * module-private registry so they can later be removed.
 *
 * Only decorations whose `line` falls within `[viewport.top - 10,
 * viewport.bottom + 10]` are applied. Out-of-range decorations are silently
 * skipped; they will be added later when the viewport scrolls into range.
 *
 * @param bufnr - The viewer buffer number.
 * @param decorations - The full `mdDecorations` array from the current
 *                      `RenderPlan`. Filtering happens inside this call.
 * @param viewport - Current viewport range with LAZY_PADDING already
 *                   factored in by the caller (or recomputed here from
 *                   `viewport.top - 10 .. viewport.bottom + 10`).
 * @spec-id europa.render.markdown.viewport-gating
 */
export type ApplyMdDecorations = (
  bufnr: number,
  decorations: readonly MdDecoration[],
  viewport: MdOverlayViewport,
) => Promise<void>;

/**
 * React to a `WinScrolled` autocmd: remove extmarks that scrolled out of
 * `[top - 10, bottom + 10]`, add extmarks that scrolled in.
 *
 * Diff strategy keeps the per-scroll extmark churn proportional to the
 * scroll distance (R4 algorithm).
 *
 * @param bufnr - The viewer buffer number.
 * @param decorations - The full `mdDecorations` array from the latest
 *                      `RenderPlan`. (Cached on the caller side; this
 *                      contract does not own the plan.)
 * @param oldViewport - Previous viewport (before scroll).
 * @param newViewport - Current viewport (after scroll).
 * @spec-id europa.render.markdown.viewport-gating
 */
export type OnViewportScrolled = (
  bufnr: number,
  decorations: readonly MdDecoration[],
  oldViewport: MdOverlayViewport,
  newViewport: MdOverlayViewport,
) => Promise<void>;

/**
 * Clear every extmark this module has placed in the buffer.
 *
 * Called on `BufWipeout` (= viewer destroyed) and before a full re-render
 * (`buildRenderPlan(notebook)` followed by `applyRenderPlan`). Internally
 * uses `nvim_buf_clear_namespace(bufnr, ns, 0, -1)` so other modules'
 * extmarks (cell markers, syntax-highlight, image placements) are NOT
 * touched.
 *
 * @param bufnr - The viewer buffer number.
 * @spec-id europa.render.markdown.viewport-gating
 */
export type ClearMdOverlay = (bufnr: number) => Promise<void>;

/**
 * Set up the viewer buffer for markdown overlay rendering.
 *
 * Configures the buffer-local options that make conceal + cursor-line
 * unconceal work out of the box:
 *
 * - `setlocal conceallevel=2` — concealed text disappears unless replaced
 *   by `cchar` (we use `cchar=""` for full hide).
 * - `setlocal concealcursor=""` — concealing is disabled on the cursor
 *   line in every mode, so the user can edit the raw markdown source
 *   without leaving the cell (R5, FR-020).
 *
 * Called once per viewer buffer at `BufWinEnter`. Idempotent — calling it
 * twice has no observable difference.
 *
 * On Vim 9.x hosts this function is a no-op (the Vim viewer never reads
 * `mdDecorations`, FR-030).
 *
 * @param bufnr - The viewer buffer number.
 * @spec-id europa.render.markdown.cursor-line-conceal
 */
export type EnsureMdOverlayBufferOptions = (bufnr: number) => Promise<void>;

/**
 * Side-effect boundary summary (informational, not enforced by the type
 * system):
 *
 * `renderMarkdown` (pure):
 * - Imports `marked` (npm via Deno `deno.json` imports) — synchronous API,
 *   no subprocess, no I/O.
 * - Builds an `MdDecoration[]` from token offsets using `String.prototype
 *   .indexOf` reverse-location (R8).
 * - Never throws (catches `marked` exceptions internally; falls back to
 *   heading-only).
 *
 * `applyMdDecorations` / `onViewportScrolled` / `clearMdOverlay`
 * (Neovim-only side effects):
 * - Call `nvim_buf_set_extmark` / `nvim_buf_del_extmark` /
 *   `nvim_buf_clear_namespace` via `@denops/std`. Batched via
 *   `denops.batch(...)` when multiple ops happen in one tick.
 * - Use a private namespace from `nvim_create_namespace("EuropaMdOverlay")`
 *   so other modules' extmarks are not affected.
 * - Maintain an `MdOverlayExtmarkRegistry` (module-private `Map`) for id
 *   tracking. Cleared on `BufWipeout`.
 *
 * `ensureMdOverlayBufferOptions` (buffer-local options):
 * - Calls `denops.call("setbufvar", bufnr, ...)` (or `:setlocal` via
 *   `denops.cmd`) for `conceallevel` / `concealcursor`. Idempotent.
 *
 * Render-layer same as 010 (`render/svg-converter.ts`):
 * - `renderMarkdown` lives in the render layer and stays synchronous and
 *   pure (DESIGN.md §3.7.5).
 * - The viewer-side functions (`applyMdDecorations` etc.) live in `view/`
 *   and own all Neovim RPC. The Vim host path is a no-op (FR-030).
 *
 * Initial paint vs partial re-render:
 * - `:edit` path schedules `applyMdDecorations` via `setTimeout(0)` so the
 *   `:edit` itself does not block on parse + extmark adds (FR-024a).
 * - iopub batch `partial-render` calls `applyMdDecorations` synchronously
 *   and accepts the per-tick latency cost when markdown is large
 *   (FR-037a, Session 2026-05-19 Q-batch-coexistence).
 */
