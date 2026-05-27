/**
 * Hand-written contract for the error traceback parser and jump executor
 * (Phase 3.8).
 *
 * Authorized by SoT separation policy (DESIGN.md §3.5 / §3.7):
 * - `ClickActionSchema` is extended in `schema/render-plan.ts` with two new
 *   union variants (`jump_to_cell_line` / `jump_to_file`) — that is the
 *   SoT for the action shapes.
 * - This file declares the runtime contract — parser function, viewer-side
 *   jump executors, and the dispatcher RPC additions — that cannot be
 *   expressed as TypeBox alone.
 *
 * @module contracts/traceback-jumper
 * @spec-id europa.render.traceback.parse.ipython8
 * @spec-id europa.view.traceback-jump.cell-line
 * @spec-id europa.view.traceback-jump.external-file
 * @spec-id europa.view.traceback-jump.missing-detection
 * @spec-id europa.dispatcher.jump-to-traceback
 * @spec-id europa.dispatcher.jump-to-traceback-list
 */

import type { Static } from "@sinclair/typebox";
import type {
  Clickable,
  ClickActionSchema,
  RenderPlan,
} from "../schema/render-plan.ts";
import type { KernelRuntime } from "./kernel-client.ts";

/**
 * A single traceback frame extracted by the parser.
 *
 * Internal to the render layer — not exported from the runtime module.
 * Exists here only as a reference shape that callers can match against.
 *
 * `line` is **fragment-relative** (0-based, index into the `lines` array
 * produced by `renderError`). `colStart` / `colEnd` are 0-based offsets
 * within that line, computed against the **stripAnsi-applied** text
 * (Session 2026-05-22 Q12=A).
 *
 * @spec-id europa.render.traceback.parse.ipython8
 */
export type TracebackFrame =
  | {
    kind: "cell";
    line: number;
    colStart: number;
    colEnd: number;
    executionCount: number; // IPython N (1-based)
    sourceLine: number; // IPython K (1-based)
  }
  | {
    kind: "file";
    line: number;
    colStart: number;
    colEnd: number;
    path: string; // quote-stripped raw path
    sourceLine: number; // IPython K (1-based)
  };

/**
 * Parse an array of ANSI-stripped traceback lines into a list of frames.
 *
 * Applies two regexes per line in priority order:
 *   1. cell frame   `/Cell In\[(\d+)\], line (\d+)/`
 *   2. file frame   `/File "?([^":\n]+?)"?:(\d+)(?:, in .+)?$/`
 *
 * Only the **first match per line** is recorded (Session Q-multiple-frames-
 * per-line). Lines without any match contribute zero frames.
 *
 * The IPython 7.x `<ipython-input-N-...>` format is intentionally NOT
 * matched (SC-017): such lines pass through silently and contribute no
 * frames, so the viewer renders them as plain `EuropaError` text.
 *
 * **Synchronous contract**: pure data transform, no I/O. `O(N · L)` time
 * for N lines of average length L. Render layer §3.7.5 invariant.
 *
 * @param strippedLines - Lines from `renderError` AFTER `stripAnsi` has
 *                        flattened embedded `\n` and removed escape codes.
 * @returns A list of frames in document order. Empty if no frames matched.
 * @spec-id europa.render.traceback.parse.ipython8
 */
export type ParseTraceback = (
  strippedLines: readonly string[],
) => readonly TracebackFrame[];

/**
 * The clickable action variant for cell-line jumps (Phase 3.8).
 *
 * Added to `ClickActionSchema` in `schema/render-plan.ts` as one of the
 * union variants. Re-exported here as a TypeScript type alias for
 * documentation convenience.
 *
 * @spec-id europa.view.traceback-jump.cell-line
 */
export type JumpToCellLineAction = Extract<
  Static<typeof ClickActionSchema>,
  { type: "jump_to_cell_line" }
>;

/**
 * The clickable action variant for external file jumps (Phase 3.8).
 *
 * @spec-id europa.view.traceback-jump.external-file
 */
export type JumpToFileAction = Extract<
  Static<typeof ClickActionSchema>,
  { type: "jump_to_file" }
>;

/**
 * Resolve a (cursor line, cursor col) pair from the viewer to the clickable
 * whose range contains it.
 *
 * Conventions:
 * - `cursorLine` / `cursorCol` are **1-origin** (= Vim `line('.')` / `col('.')`
 *   values from the dispatcher RPC arguments).
 * - `clickables[].line` is **0-origin absolute buffer line** (= post-flatten,
 *   Session Q-line-coordinate confirmed).
 * - `clickables[].colStart` / `colEnd` are 0-origin half-open `[colStart, colEnd)`.
 *
 * Linear scan is acceptable; the number of clickables per Notebook is bounded
 * (≤ 100, Technical Context scale).
 *
 * @returns Matching clickable, or `null` when the cursor is outside every
 *          clickable range. The viewer treats `null` as a silent no-op
 *          (FR-014 case 3).
 * @spec-id europa.view.traceback-jump.cell-line
 * @spec-id europa.view.traceback-jump.external-file
 */
export type FindClickableAtCursor = (
  clickables: readonly Clickable[],
  cursorLine: number,
  cursorCol: number,
) => Clickable | null;

/**
 * Execute a `jump_to_cell_line` action against the viewer buffer.
 *
 * Steps (FR-016):
 *   1. Look up the cell by `executionCount` in `plan.cellMap` cross-
 *      referenced with `plan.cellRanges` and the live notebook (= cell with
 *      `cell.execution_count === N`).
 *   2. If no such cell exists: silent no-op (Q4=A).
 *   3. If K is outside the cell's source range (`sourceEndLine -
 *      sourceStartLine`): silent no-op (Session Q-K-out-of-range).
 *   4. Compute 1-based target buffer line = `cellSourceRanges[idx].sourceStartLine
 *      + K` (= 0-based sourceStartLine + 1-based K = 1-based absolute line,
 *      pass directly to `setpos`; FR-016).
 *   5. `setpos('.', [bufnr, targetLine, 1, 0])` + `normal! zz` (Q7=A).
 *
 * Operates entirely on the viewer buffer; never opens a new window.
 *
 * @param bufnr - Viewer buffer number.
 * @param plan - The latest RenderPlan (provides cellMap / cellRanges /
 *               cellSourceRanges for cell resolution).
 * @param action - The matched `jump_to_cell_line` clickable action.
 * @spec-id europa.view.traceback-jump.cell-line
 */
export type JumpToCellLine = (
  bufnr: number,
  plan: RenderPlan,
  action: JumpToCellLineAction,
) => Promise<void>;

/**
 * Execute a `jump_to_file` action by opening the external file in a split.
 *
 * Path resolution order (Session Q-absolute-path confirmed):
 *   1. POSIX absolute (`/...`) or Windows absolute (`X:\...` / `X:/...`)
 *      → use **as-is** (skip cwd resolution).
 *   2. Tilde-prefix (`~...`) → HOME expansion via
 *      `Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")`.
 *   3. Otherwise (relative path) → `resolve(kernelCwd, path)` via
 *      `@std/path`.
 *
 * After resolution, executes `:split <fnameescape(resolved)>` followed by
 * `setpos` + `normal! zz` in the new window (FR-017, Q11=B).
 *
 * Does NOT validate that the file exists; relies on Vim's standard
 * `:split` error (`E:Cannot find file ...`) — see US2 AC3.
 *
 * @param kernelRuntime - The active SessionRuntime's `kernelRuntime`,
 *                        from which `cwd` is read (FR-018).
 * @param action - The matched `jump_to_file` clickable action.
 * @spec-id europa.view.traceback-jump.external-file
 */
export type JumpToFile = (
  kernelRuntime: KernelRuntime,
  action: JumpToFileAction,
) => Promise<void>;

/**
 * Walk the RenderPlan's clickables and, for every `jump_to_cell_line` whose
 * target cell does not exist OR whose K is out-of-range, rewrite the
 * corresponding highlight from `EuropaErrorJump` to `EuropaErrorJumpMissing`
 * before applying highlights to the buffer (FR-012a).
 *
 * The matching strategy is **position-based**: the highlight whose `line`,
 * `col`, `endCol` matches the clickable's `line`, `colStart`, `colEnd` is
 * the one to rewrite. (Render layer emits them as a pair; this contract
 * makes the position match explicit so future changes don't break it.)
 *
 * `jump_to_file` actions are NOT subject to file-existence checks here;
 * `EuropaErrorJump` stays applied even for non-existent files (= Vim's
 * standard `:split` error handles that interactively).
 *
 * @param plan - The RenderPlan whose `highlights` array will be mutated
 *               in place. `clickables` is read-only.
 * @param notebookSelector - Callback to look up a cell by execution_count;
 *                           returns the cellSourceRange for actionable
 *                           cells or null when missing/out-of-range.
 * @spec-id europa.view.traceback-jump.missing-detection
 */
export type RewriteMissingHighlights = (
  plan: RenderPlan,
  notebookSelector: (executionCount: number, line: number) =>
    | { actionable: true; sourceStartLine: number; sourceEndLine: number }
    | { actionable: false },
) => void;

/**
 * Populate the quickfix list with every actionable frame from the latest
 * RenderPlan's clickables (FR-015).
 *
 * Actionable filter (Session Q-qflist-out-of-range confirmed):
 *   - `jump_to_cell_line`: cell with `execution_count === N` exists in
 *     cellMap AND K is within the cell's source range. Otherwise skipped.
 *   - `jump_to_file`: always actionable (file existence is not checked).
 *
 * Side effects:
 *   - Calls `setqflist(list, 'r', {title: 'Europa traceback'})` once with
 *     the full populated list (R7 confirmed).
 *   - Does NOT open the quickfix window (`:copen`) and does NOT auto-jump
 *     (US3 AC2).
 *
 * @param bufnr - Viewer buffer number (used to set `bufnr` field on cell
 *                frame entries).
 * @param plan - Current RenderPlan with absolute-buffer-line clickables.
 * @param kernelRuntime - For resolving external file paths the same way
 *                        as `jumpToFile` (R4).
 * @param notebookSelector - Same callback type as
 *                           `RewriteMissingHighlights.notebookSelector`,
 *                           used to enforce the actionable filter.
 * @spec-id europa.dispatcher.jump-to-traceback-list
 */
export type PopulateTracebackQflist = (
  bufnr: number,
  plan: RenderPlan,
  kernelRuntime: KernelRuntime,
  notebookSelector: (executionCount: number, line: number) =>
    | { actionable: true; sourceStartLine: number; sourceEndLine: number }
    | { actionable: false },
) => Promise<void>;

/**
 * Dispatcher RPC: jump to the frame currently under the cursor.
 *
 * Phase 3.8 addition to `EuropaDispatcher` (FR-013 / FR-014).
 * Implementation in `view/traceback-jump.ts`, registered in `main.ts`.
 *
 * Behaviour outline:
 *   1. Guard: `bufexists(bufnr)` — if `0`, throw command error
 *      `"Europa: no active notebook viewer"` (FR-019a).
 *   2. Guard: `bufwinid(bufnr)` — if `-1` (viewer hidden):
 *      - When `b:europa_jump_warned == 1`: silent no-op.
 *      - Otherwise: warn `"Europa: viewer buffer is not visible"` then
 *        set `b:europa_jump_warned = 1` (via `setbufvar`) and no-op. The
 *        buffer-local flag is reset to `0` on `BufWinEnter`, so the warning
 *        fires once per hidden interval (FR-019).
 *   3. `findClickableAtCursor(plan, line, col)` — null → silent no-op.
 *   4. Dispatch on action type:
 *      - `jump_to_cell_line` → `jumpToCellLine(bufnr, plan, action)`
 *      - `jump_to_file`      → `jumpToFile(kernelRuntime, action)`
 *
 * Arguments are typed as `unknown` because the dispatcher contract receives
 * them across the RPC boundary; internal validation uses TypeBox
 * `Value.Check` against integers/positive numbers.
 *
 * @spec-id europa.dispatcher.jump-to-traceback
 */
export type DispatcherJumpToTraceback = (
  bufnr: unknown,
  line: unknown,
  col: unknown,
) => Promise<void>;

/**
 * Dispatcher RPC: populate the quickfix list with every actionable frame.
 *
 * Phase 3.8 addition to `EuropaDispatcher` (FR-013 / FR-015).
 * Implementation in `view/traceback-jump.ts`, registered in `main.ts`.
 *
 * Behaviour outline:
 *   1. Same `bufexists` / `bufwinid` guards as `jumpToTraceback`.
 *   2. `populateTracebackQflist(bufnr, plan, kernelRuntime, ...)` — sets
 *      qflist with `setqflist(list, 'r', {title: 'Europa traceback'})`.
 *   3. Does NOT open the quickfix window or auto-jump (US3 AC2).
 *
 * @spec-id europa.dispatcher.jump-to-traceback-list
 */
export type DispatcherJumpToTracebackList = (
  bufnr: unknown,
) => Promise<void>;

/**
 * Side-effect boundary summary (informational, not enforced by the type
 * system):
 *
 * `parseTraceback` (pure):
 * - Two regex matches per line (`String.prototype.match`).
 * - Builds `TracebackFrame[]` array, never throws.
 * - No I/O, no subprocess, no host RPC.
 *
 * `findClickableAtCursor` (pure):
 * - Linear scan over `clickables`. No side effects.
 *
 * `rewriteMissingHighlights` (mutates plan.highlights):
 * - In-place mutation of `RenderPlan.highlights[].hlGroup` for entries
 *   whose position matches an actionable-but-missing clickable.
 * - No host RPC.
 *
 * `jumpToCellLine` / `jumpToFile` / `populateTracebackQflist` (viewer
 * side effects):
 * - Call `denops.cmd("setpos ...")` / `denops.cmd("normal! zz")` /
 *   `denops.cmd("split " + fnameescape(...))` /
 *   `denops.call("setqflist", ...)` via `@denops/std`.
 * - Read-only access to `SessionRuntime.kernelRuntime.cwd`.
 * - No mutation of buffer text (= nbformat-pristine guaranteed, FR-027).
 *
 * `DispatcherJumpToTraceback` / `DispatcherJumpToTracebackList` (RPC entry
 * points):
 * - Validate arguments with TypeBox `Value.Check`.
 * - Dispatch to the appropriate pure/viewer functions above.
 *
 * Host parity (Vim 9.x vs Neovim, R6 confirmed):
 * - All operations use Vim/Neovim shared APIs (`setpos`, `:split`,
 *   `setqflist`, `normal! zz`, `prop_add` with priority arg / extmark
 *   priority field). No host-specific module split is required —
 *   `view/traceback-jump.ts` is single-file for both hosts.
 * - Priority values are swapped per host inside the apply layer
 *   (`view/viewer.ts`): Neovim uses 200 / 100, Vim uses 100 / 200 to
 *   produce the same visual layering. See R2.
 */
