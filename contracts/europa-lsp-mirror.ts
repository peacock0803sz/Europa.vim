/**
 * Hand-written contract for the notebook mirror builder, normalizer, line
 * mapper, write-back distributor, and view-side region focus (Phase 3.9).
 *
 * Authorized by SoT separation policy (DESIGN.md §1.3 原則 1 / §3.5 / §3.7):
 * - `EuropaConfigSchema.lsp_enable` (= g:europa_lsp_enable) is added in
 *   `schema/config.ts` as a literal union — that is the SoT for the toggle.
 * - `LspMirrorState` / `CellRegion` / `LineProvenance` are added in
 *   `schema/session.ts` as TypeBox schemas — that is the SoT for the mirror
 *   data shape (all plain serializable data, TypeBox-expressible).
 * - This file declares the runtime / behavioral contract — the pure
 *   mirror-building / normalizing / line-mapping / write-back functions and
 *   the view-side region focus — that cannot be expressed as TypeBox alone.
 *
 * @module contracts/europa-lsp-mirror
 * @spec-id europa.lsp.mirror.build
 * @spec-id europa.lsp.mirror.normalize
 * @spec-id europa.lsp.mirror.linemap
 * @spec-id europa.lsp.mirror.writeback
 * @spec-id europa.view.lsp.edit-cell-region
 * @spec-id europa.config.lsp-enable-default
 */

import type { Cell, Notebook } from "../schema/notebook.ts";
import type {
  CellRegion,
  LineProvenance,
  LspMirrorState,
} from "../schema/session.ts";

// Re-export the schema-owned mirror data types for documentation convenience.
// Single SoT = schema/session.ts (TypeBox); see data-model.md §2 / §3.
export type { CellRegion, LineProvenance, LspMirrorState };

/** The `{ kind: "magic", original }` provenance variant, narrowed. */
export type MagicProvenance = Extract<LineProvenance, { kind: "magic" }>;

/**
 * Result of building a mirror from a notebook (pure data transform output).
 *
 * `cellRegions` and `lineProvenance` are exactly the fields stored on
 * `LspMirrorState` (data-model.md §2); the I/O layer (`lsp/workspace.ts`)
 * pairs them with `mirrorPath` / `workspaceRoot` / `mirrorDir` after resolving
 * placement (cleanup targets `mirrorPath` / `mirrorDir`, never `workspaceRoot`).
 *
 * Invariant: `lineProvenance.length === text.split("\n").length` (every
 * mirror line has exactly one provenance entry, data-model.md §6).
 *
 * @spec-id europa.lsp.mirror.build
 */
export type MirrorBuildResult = {
  /** Full mirror text (suppression header + per-cell marker + content). */
  text: string;
  /** Per code-cell region, in notebook order (markdown/raw cells excluded). */
  cellRegions: readonly CellRegion[];
  /** Per mirror line provenance (index = 0-based mirror line). */
  lineProvenance: readonly LineProvenance[];
};

/**
 * Build the whole on-disk mirror text from a notebook (pure, synchronous).
 *
 * Layout (research.md §2 / §3):
 *   1. An inline suppression header at the very top (provenance `"header"`):
 *        `# pyright: reportUnusedExpression=false`
 *        `# ruff: noqa: B018, B015`
 *      (= inherits the user's project pyright/ruff config + venv; NO competing
 *      config file is written. ty suppression is confirmed at impl time, §10.)
 *   2. For each **code** cell in notebook order (markdown / raw cells are
 *      skipped, Session 2026-05-27): a boundary marker `# %% <cellId>`
 *      (provenance `"marker"`), then the cell's source run through
 *      `normalizeCell` (one mirror line per source line — line count is
 *      preserved so cell line K maps to a single mirror line, FR-012a).
 *
 * Cross-cell symbols resolve naturally because the whole notebook is a single
 * Python module (Q-mechanism=X, FR-008). `cellRegions` enables go-to-definition
 * reverse mapping (FR-010) and `:EuropaEditCell` region focus (FR-005a).
 *
 * **Synchronous contract**: pure data transform, no I/O, no host RPC. Knows
 * nothing of disk paths, the cell-edit buffer map, or the host. `O(total
 * source lines)`; full regeneration on every mutation is acceptable
 * (research.md §8). The I/O layer writes `text` to disk separately.
 *
 * @param notebook - The current in-memory notebook (post any 004 mutation).
 * @returns Mirror text + cellRegions + lineProvenance.
 * @spec-id europa.lsp.mirror.build
 * @spec-id europa.lsp.mirror.linemap
 */
export type BuildMirror = (notebook: Notebook) => MirrorBuildResult;

/**
 * Normalize a single cell's source into valid Python, preserving line count
 * (pure, synchronous).
 *
 * Rules (research.md §3, FR-012a / FR-012b):
 *   1. **line magic** (first non-blank char is `%`, not `%%`, e.g.
 *      `%timeit foo()`) → comment the line in place (`# ` prefix), record
 *      `{ kind: "magic", original }`. Line is NOT removed (count preserved).
 *   2. **shell escape** (leading `!`, e.g. `!pip install x`) → same.
 *   3. **help** (line ends with `?` / `??`, e.g. `obj?` / `obj??`) → same.
 *   4. **cell magic** (the cell's first non-blank line is `%%...`, e.g.
 *      `%%bash`) → comment out **every** line of the cell (the body is
 *      non-Python); each line gets a `{ kind: "magic", original }` entry so
 *      the whole cell is reversible.
 *   5. any other line → kept verbatim (provenance `"content"`).
 *
 * The header / marker lines are NOT produced here — `buildMirror` prepends
 * them. `normalizeCell` returns one entry per input line; `lines.length`
 * always equals `provenance.length` and equals the input line count
 * (FR-012a line-count preservation → 1:1 cell↔mirror mapping). An empty or
 * whitespace-only cell yields exactly one (possibly empty) content line, so
 * every code cell occupies >=1 mirror line and its region satisfies
 * `startLine == endLine` (focusable; regions stay contiguous — the empty-cell
 * convention).
 *
 * @param source - The cell's raw source (joined with `\n` per cell).
 * @returns Normalized lines + per-line provenance (same length as input).
 * @spec-id europa.lsp.mirror.normalize
 */
export type NormalizeCell = (
  source: string,
) => { lines: readonly string[]; provenance: readonly LineProvenance[] };

/**
 * De-normalize one mirror buffer line back to its cell source line, or drop
 * it (pure, synchronous). Inverse of the per-line normalization (research.md
 * §4, FR-012d).
 *
 * Behavior by provenance:
 *   - `"content"` → return `bufferLine` verbatim (user edits respected).
 *   - `"marker"` / `"header"` → return `null` (= drop; never written to a
 *     cell, FR-013 / data-model.md §6 invariant).
 *   - `{ kind: "magic", original }` → if `bufferLine` still equals the
 *     normalized form of `original` (= the line was NOT edited), return
 *     `original` (restore the pre-normalization notebook syntax, US6 AC5).
 *     If it differs (= the user edited the commented line), return
 *     `bufferLine` as-is (respect the edit, research.md §4).
 *
 * This is what keeps the saved `.ipynb` nbformat-pristine: untouched magic /
 * shell / help lines round-trip to their original text (FR-016 / SC-011).
 *
 * @param bufferLine - The mirror buffer's current text for this line.
 * @param prov - The provenance recorded for this mirror line at build time.
 * @returns The cell source line, or `null` to drop the line.
 * @spec-id europa.lsp.mirror.writeback
 */
export type DenormalizeLine = (
  bufferLine: string,
  prov: LineProvenance,
) => string | null;

/**
 * Reverse-map a 0-based mirror line to its owning cell and in-cell line
 * (pure, synchronous). Used by cross-cell go-to-definition landing (FR-010).
 *
 * Resolution:
 *   - If `line` falls within some `region` (`startLine <= line <= endLine`):
 *     return `{ cellId: region.cellId, cellLine: line - region.startLine }`
 *     (= 0-based in-cell line, exact because line count is preserved).
 *   - If `line` is a marker / header line, or outside every region:
 *     return `null` (= the caller maps to the nearest cell or no-ops, spec
 *     Edge Cases "go-to-definition が境界マーカ行に着地").
 *
 * @param regions - `LspMirrorState.cellRegions` for the current mirror.
 * @param line - 0-based mirror line the client landed on.
 * @returns Owning cell + in-cell line, or `null`.
 * @spec-id europa.lsp.mirror.linemap
 */
export type MapMirrorLineToCell = (
  regions: readonly CellRegion[],
  line: number,
) => { cellId: string; cellLine: number } | null;

/**
 * Forward-map a cell + in-cell line to its 0-based mirror line (pure,
 * synchronous). Used by `:EuropaEditCell` to focus a cell's region (FR-005a).
 *
 * Resolution: find the region with matching `cellId`; if `cellLine` is within
 * `[0, endLine - startLine]`, return `region.startLine + cellLine`. Returns
 * `null` when the cell is not in the mirror (e.g. a markdown cell, which is
 * never mirrored) or `cellLine` is out of range.
 *
 * @param regions - `LspMirrorState.cellRegions` for the current mirror.
 * @param cellId - The target cell's id.
 * @param cellLine - 0-based in-cell line.
 * @returns 0-based mirror line, or `null`.
 * @spec-id europa.lsp.mirror.linemap
 */
export type MapCellLineToMirror = (
  regions: readonly CellRegion[],
  cellId: string,
  cellLine: number,
) => number | null;

/**
 * Distribute an edited mirror buffer's lines back into per-cell sources
 * (pure, synchronous). The data core of the write-back path (FR-013); the
 * dispatcher's `saveCellEdit` (`@spec-id europa.dispatcher.save-cell-edit`,
 * `dispatcher/cell/edit.ts:65`) calls this then commits each cell source.
 *
 * Algorithm (robust to formatter / user line insert+delete — the edited buffer
 * may NOT match `build`'s line counts, so the fixed `[startLine, endLine]`
 * offsets MUST NOT be used to slice it):
 *   1. Re-scan `mirrorLines` top-to-bottom for boundary markers
 *      (`# %% <cellId>`, counted ONLY when `<cellId>` is in the build's
 *      `cellRegions` — a user-typed `# %% ...` line stays cell content). Each
 *      marker opens a cell block running until the next marker (or EOF); lines
 *      above the first marker (the suppression header) are dropped. Deriving
 *      boundaries from the LIVE buffer means a formatter that adds/removes
 *      lines inside a cell still splits back to the right cell (FR-013).
 *   2. Within each block, de-normalize each line: drop the marker; restore an
 *      untouched magic line to its `original` (matched against `build`'s magic
 *      provenance for that cell — positionally when the block's line count is
 *      unchanged, else treated as edited and kept verbatim); keep every other
 *      (content / edited / inserted) line as-is.
 *   3. Join the surviving lines with `\n` → that cell's new source.
 *
 * Header lines (above the first marker) are excluded entirely.
 * The result preserves nbformat-pristine: untouched magic lines come back as
 * their original notebook syntax (FR-016 / SC-011).
 *
 * @param mirrorLines - The mirror buffer's current full contents (one entry
 *                       per line, e.g. from `getbufline(bufnr, 1, "$")`).
 * @param build - The regions / provenance of the build that produced the
 *                buffer the user edited. Only these two fields are consumed
 *                (`text` is not), so `LspMirrorState` is accepted directly.
 * @returns One `{ cellId, source }` per code cell, in notebook order.
 * @spec-id europa.lsp.mirror.writeback
 */
export type DistributeWriteBack = (
  mirrorLines: readonly string[],
  build: Pick<MirrorBuildResult, "cellRegions" | "lineProvenance">,
) => ReadonlyArray<{ cellId: string; source: string }>;

/**
 * View-side: open (or reuse) the mirror buffer and focus a cell's region
 * (host I/O, async). Replaces the 004 `openCellEditBuffer`
 * (`@spec-id europa.view.viewer.scratch-open`, `view/viewer.ts:496`) path
 * when LSP is enabled (FR-005a); 004 scratch is the fallback (FR-004).
 *
 * Steps (research.md §6 / §7):
 *   1. Resolve the mirror buffer by its real on-disk path (= buffer name).
 *      Open it (`bufadd`/`bufload` + `:split`) or reuse an existing window
 *      (same reuse semantics as `openCellEditBuffer`'s reuse path). Set
 *      `&buftype=acwrite` + a `BufWriteCmd` autocmd → `saveCellEdit`; if a
 *      target client is found to filter `acwrite`, fall back to `buftype=""`
 *      + `BufWritePost` (the real on-disk file makes this safe, research.md §6).
 *      `&filetype` follows `resolveScratchFiletype`
 *      (`@spec-id europa.view.viewer.resolve-filetype`, `viewer.ts:463`) → `python`.
 *   2. Look up the cell's region via the session's `lspMirror.cellRegions`
 *      (= `mapCellLineToMirror(regions, cellId, 0)`).
 *   3. `foldmethod=manual`; fold every NON-target region so only the target
 *      cell shows (cross-cell stays visible to the LSP server; the user can
 *      `zR`/`zo` to expand, research.md §7).
 *   4. `setpos('.', [bufnr, regionStartLine + 1, 1, 0])` + `normal! zz` to
 *      focus the region top. A repeat `:EuropaEditCell` for the same cell
 *      focuses the same region (= mirror version of 004 FR-020 reuse).
 *
 * Uses only Vim/Neovim-shared APIs (fold / `setpos` / real file) — no
 * host-specific RPC (FR-025 / SC-012). Reads `SessionRuntime.lspMirror`;
 * never mutates buffer text on its own (= nbformat-pristine, FR-016).
 *
 * @param denops - Active Denops instance.
 * @param viewerBufnr - The notebook viewer buffer number (for session lookup).
 * @param cellId - The cell whose region should be focused.
 * @spec-id europa.view.lsp.edit-cell-region
 */
export type OpenCellRegion = (
  denops: unknown, // Denops — typed `unknown` here to avoid a runtime import in the contract
  viewerBufnr: number,
  cellId: string,
) => Promise<void>;

/**
 * Resolve `g:europa_lsp_enable` to an effective on/off decision for a cell
 * (pure, synchronous). Backs the `"auto"` semantics (research.md §11).
 *
 * - `false` → always off (= 004 acwrite scratch, FR-004).
 * - `true`  → on for python notebooks only; a non-python notebook still falls
 *   back to the 004 scratch (mirror normalization + suppression are
 *   Python-specific, FR-004 / FR-006). `true` is an explicit opt-in that
 *   overrides any future `"auto"` skip heuristic for python notebooks.
 * - `"auto"` (default) → on iff `resolveScratchFiletype(notebook, cell)`
 *   returns `"python"` (FR-006 gating, SC-003). kernel state is
 *   NOT consulted (notebook-metadata-driven, kernel-independent).
 *
 * Both `true` and `"auto"` are therefore python-gated; they differ only in that
 * `"auto"` may add further auto-skip heuristics later while `true` forces on
 * for python notebooks.
 *
 * This contract documents the decision; the value itself is the TypeBox
 * `EuropaConfigSchema.lsp_enable` literal union (data-model.md §1).
 *
 * @param setting - The resolved `g:europa_lsp_enable` value.
 * @param notebook - The notebook (for `resolveScratchFiletype`).
 * @param cell - The cell being edited.
 * @returns `true` to use the mirror, `false` to use the 004 scratch.
 * @spec-id europa.config.lsp-enable-default
 */
export type ResolveLspEnabled = (
  setting: "auto" | true | false,
  notebook: Notebook,
  cell: Cell,
) => boolean;

/**
 * Side-effect boundary summary (informational, not enforced by the type
 * system):
 *
 * `buildMirror` / `normalizeCell` / `denormalizeLine` / `mapMirrorLineToCell`
 * / `mapCellLineToMirror` / `distributeWriteBack` / `resolveLspEnabled`
 * (all pure):
 * - Pure data transforms over strings / arrays. No I/O, no subprocess, no
 *   host RPC, never throw on well-formed input. Live in `lsp/mirror.ts`
 *   (build / linemap), `lsp/normalize.ts` (normalize / denormalize), and
 *   `lsp/writeback.ts` (distribute). Synchronous per DESIGN.md §3.7.5.
 *
 * I/O layer (`lsp/workspace.ts`, NOT declared here as a function shape):
 * - Resolves `mirrorPath` / `workspaceRoot` / `mirrorDir` (research.md §1),
 *   writes `buildMirror().text` to disk, and cleans up on BufWipeout (delete
 *   the `mirrorPath` file) / process exit (delete the file for a
 *   project-placed mirror whose `.europa/lsp/` dir may be shared; remove the
 *   whole per-session cache `mirrorDir` for an unsaved notebook, recognizable
 *   by `workspaceRoot === mirrorDir`). Cleanup NEVER deletes `workspaceRoot`
 *   (= the user's project root) — only `mirrorPath` / `mirrorDir` (the
 *   dedicated `.europa/lsp/` or cache dir), FR-018. Uses only `@std/fs` /
 *   `@std/path` (no new deps, FR-028).
 *
 * `openCellRegion` (view side effects):
 * - Calls `denops.call("bufadd"/"bufload"/...)`, `denops.cmd(":split ..." /
 *   "setpos ..." / "normal! zz" / fold)` via `@denops/std`. Reads
 *   `SessionRuntime.lspMirror`. No buffer-text mutation of its own.
 *
 * Host parity (Vim 9.x vs Neovim, FR-025 / SC-012):
 * - All mirror operations use shared APIs (fold / `setpos` / real on-disk
 *   file + `acwrite`/`BufWriteCmd`). No host-specific module split — the
 *   `lsp/` directory and the viewer branch are single-file for both hosts.
 * - LSP client differences (nvim-lspconfig / vim-lsp / coc.nvim / built-in)
 *   are out of Europa's scope (FR-007a / FR-026): Europa never holds
 *   client-specific code and exposes no client-selection config (FR-020).
 *
 * Cross-cell + client-agnostic (FR-007a / FR-007b):
 * - The single concatenated mirror is what makes cross-cell resolution work
 *   for any standard client (the client sends the attached buffer to the
 *   server). The LSP 3.17 `notebookDocument` sync method is intentionally
 *   NOT used (it would require a supporting client, contradicting
 *   client-agnosticism).
 */
export type _LspMirrorContractRef = LspMirrorState;
