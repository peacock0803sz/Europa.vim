/**
 * Phase 3.8 traceback line-jump executor.
 *
 * Pure helpers (`findClickableAtCursor`, `rewriteMissingHighlights`,
 * `resolveFilePath`) are unit-testable without a live host. Async helpers
 * (`jumpToCellLine`, `jumpToFile`) perform viewer-side cursor / window
 * effects via `denops.cmd` and depend only on the contract types from
 * `schema/render-plan.ts` + `contracts/kernel-client.ts`.
 *
 * Host parity (R6): all I/O uses Vim/Neovim shared APIs (`setpos`, `:split`,
 * `normal! zz`). No host-specific module split required.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import { isAbsolute } from "@std/path/is-absolute";
import { resolve } from "@std/path/resolve";
import type {
  CellSourceRange,
  Clickable,
  Highlight,
  RenderPlan,
} from "../../../schema/render-plan.ts";
import type { Notebook } from "../../../schema/notebook.ts";

/**
 * Neovim namespace name used by `applyTracebackHighlights`. Stable across
 * calls so each apply clears the previous frame's extmarks via
 * `nvim_buf_clear_namespace`.
 */
const TRACEBACK_HL_NAMESPACE = "europa_traceback_hl";

/**
 * Vim text-property types this layer applies. Type registration lives in
 * `plugin/europa.vim` (R9); the apply path only emits / removes props.
 */
const TRACEBACK_PROP_TYPES = [
  "EuropaErrorJump",
  "EuropaErrorJumpMissing",
] as const;

/**
 * Resolve cursor coordinates (1-origin from Vim) to the clickable whose
 * range contains them.
 *
 * Half-open `[colStart, colEnd)` matches the convention used by
 * `parseTraceback` and `renderError`.
 *
 * @returns Matching clickable or `null` when no clickable covers the
 *          cursor. The dispatcher treats `null` as a silent no-op
 *          (FR-014 case 3).
 */
export function findClickableAtCursor(
  clickables: readonly Clickable[],
  cursorLine: number,
  cursorCol: number,
): Clickable | null {
  // Vim 1-origin → 0-origin
  const line = cursorLine - 1;
  const col = cursorCol - 1;
  for (const c of clickables) {
    if (c.line === line && c.colStart <= col && col < c.colEnd) {
      return c;
    }
  }
  return null;
}

/**
 * Rewrite the highlight group of every `jump_to_cell_line` clickable whose
 * target cell does not exist or whose K is out of range from
 * `EuropaErrorJump` to `EuropaErrorJumpMissing`. Mutates `plan.highlights`
 * in place. `jump_to_file` clickables are not subject to this check (=
 * file existence is delegated to Vim's `:split` error).
 *
 * @spec-id europa.view.traceback-jump.missing-detection
 */
export function rewriteMissingHighlights(
  plan: RenderPlan,
  notebookSelector: (
    executionCount: number,
    line: number,
  ) =>
    | { actionable: true; sourceStartLine: number; sourceEndLine: number }
    | { actionable: false },
): void {
  for (const c of plan.clickables) {
    if (c.action.type !== "jump_to_cell_line") continue;
    const res = notebookSelector(
      c.action.payload.executionCount,
      c.action.payload.line,
    );
    if (res.actionable) continue;
    const hl = findMatchingHighlight(plan.highlights, c);
    if (hl) hl.hlGroup = "EuropaErrorJumpMissing";
  }
}

function findMatchingHighlight(
  highlights: Highlight[],
  c: Clickable,
): Highlight | undefined {
  return highlights.find(
    (h) =>
      h.hlGroup === "EuropaErrorJump" &&
      h.line === c.line &&
      h.col === c.colStart &&
      h.endCol === c.colEnd,
  );
}

/**
 * Execute a `jump_to_cell_line` action against the viewer buffer.
 *
 * Silent no-op when (1) the cell is not found or (2) K is outside the
 * cell's source range (Session Q-K-out-of-range). Otherwise moves the
 * cursor to `sourceStartLine + K` (= 0-based start line + 1-based K =
 * 1-based absolute target line) and centers the viewport with `zz`.
 *
 * Resolver is passed by the dispatcher so this function stays free of
 * SessionStore knowledge for unit-test isolation.
 *
 * @spec-id europa.view.traceback-jump.cell-line
 */
export async function jumpToCellLine(
  denops: Denops,
  bufnr: number,
  cellResolver: (executionCount: number) =>
    | { found: true; sourceStartLine: number; sourceEndLine: number }
    | { found: false },
  action: { payload: { executionCount: number; line: number } },
): Promise<void> {
  const res = cellResolver(action.payload.executionCount);
  if (!res.found) return;
  const k = action.payload.line;
  const sourceLen = res.sourceEndLine - res.sourceStartLine;
  if (k < 1 || k > sourceLen) return;
  // 0-based sourceStartLine + 1-based K = 1-based absolute buffer line.
  const targetLine = res.sourceStartLine + k;
  await denops.cmd(`call setpos('.', [${bufnr}, ${targetLine}, 1, 0])`);
  await denops.cmd("normal! zz");
}

/**
 * Resolve an IPython traceback `File ...` path against the kernel's cwd.
 *
 *   - POSIX absolute (`/...`)    → as-is.
 *   - Tilde-prefix (`~...`)      → HOME expansion via `Deno.env.get("HOME")`.
 *   - Otherwise (relative)       → `resolve(kernelCwd, rawPath)`.
 *
 * Pure function: no I/O beyond reading `HOME` from the environment. Used
 * by both `jumpToFile` and the qflist populator.
 */
export function resolveFilePath(rawPath: string, kernelCwd: string): string {
  if (isAbsolute(rawPath)) return rawPath;
  if (rawPath.startsWith("~")) {
    const home = Deno.env.get("HOME") ?? "";
    return home + rawPath.slice(1);
  }
  return resolve(kernelCwd, rawPath);
}

/**
 * Build a notebook selector compatible with `rewriteMissingHighlights` and
 * the upcoming qflist populator.
 *
 * Returns `{ actionable: true, sourceStartLine, sourceEndLine }` when
 * `notebook.cells[i].cell_type === "code"` and
 * `notebook.cells[i].execution_count === executionCount` AND `K` is within
 * the cell's source range. Otherwise `{ actionable: false }` — the apply
 * layer downgrades the highlight, and the qflist populator skips the
 * entry.
 */
export function makeNotebookSelector(
  notebook: Notebook,
  cellSourceRanges: readonly CellSourceRange[] | undefined,
): (
  executionCount: number,
  line: number,
) =>
  | { actionable: true; sourceStartLine: number; sourceEndLine: number }
  | { actionable: false } {
  return (executionCount: number, line: number) => {
    const cell = notebook.cells.find(
      (c) =>
        c.cell_type === "code" &&
        c.execution_count === executionCount,
    );
    if (!cell) return { actionable: false };
    const range = cellSourceRanges?.find((r) => r.cellId === cell.id);
    if (!range) return { actionable: false };
    const sourceLen = range.sourceEndLine - range.sourceStartLine;
    if (line < 1 || line > sourceLen) return { actionable: false };
    return {
      actionable: true,
      sourceStartLine: range.sourceStartLine,
      sourceEndLine: range.sourceEndLine,
    };
  };
}

/**
 * Register the Vim text-property types this layer applies.
 *
 * Must run AFTER `defineHighlights` because `prop_type_add` raises E970
 * if its `highlight` argument refers to an undefined group. The init
 * dispatcher invokes this after the `hi default link` declarations land.
 *
 * No-op on Neovim — the host uses extmark namespaces (not prop types)
 * and `prop_type_*` is undefined there.
 */
export async function registerTracebackPropTypes(host: Denops): Promise<void> {
  if (host.meta.host !== "vim") return;
  const existing = ((await host.eval("prop_type_list()")) as string[] | null) ??
    [];
  for (const name of TRACEBACK_PROP_TYPES) {
    if (existing.includes(name)) continue;
    await host.call("prop_type_add", name, { highlight: name });
  }
}

/**
 * Apply traceback line-jump highlights to the buffer.
 *
 * Filters `plan.highlights` to the `EuropaErrorJump` /
 * `EuropaErrorJumpMissing` groups and emits them via the host-native
 * highlight API. Each call clears the previous frame's highlights so
 * re-renders don't accumulate stale marks.
 *
 * Priority values per R2: Neovim uses 200 (higher wins, front), Vim uses
 * 100 (lower wins, front). The numeric reversal yields the same visual
 * stacking on both hosts.
 *
 * The companion executors (`jumpToCellLine` / `jumpToFile`) carry the
 * `europa.view.traceback-jump.*` spec-ids — this function is the shared
 * visual layer they depend on.
 */
export async function applyTracebackHighlights(
  host: Denops,
  bufnr: number,
  plan: RenderPlan,
): Promise<void> {
  const isNvim = host.meta.host === "nvim";
  const targets = plan.highlights.filter(
    (h) =>
      h.hlGroup === "EuropaErrorJump" ||
      h.hlGroup === "EuropaErrorJumpMissing",
  );
  if (isNvim) {
    const ns = await host.call(
      "nvim_create_namespace",
      TRACEBACK_HL_NAMESPACE,
    ) as number;
    await host.call("nvim_buf_clear_namespace", bufnr, ns, 0, -1);
    for (const hl of targets) {
      await host.call(
        "nvim_buf_set_extmark",
        bufnr,
        ns,
        hl.line,
        hl.col,
        { end_col: hl.endCol, hl_group: hl.hlGroup, priority: 200 },
      );
    }
    return;
  }
  // Vim path: prop_remove (clear) → prop_add (apply) per type.
  for (const propType of TRACEBACK_PROP_TYPES) {
    await host.call("prop_remove", { type: propType, bufnr, all: 1 });
  }
  for (const hl of targets) {
    const length = hl.endCol - hl.col;
    if (length <= 0) continue;
    await host.call("prop_add", hl.line + 1, hl.col + 1, {
      bufnr,
      type: hl.hlGroup,
      length,
      priority: 100,
    });
  }
}

/**
 * Populate the quickfix list with every actionable traceback frame in the
 * RenderPlan.
 *
 * Actionable filter (Session Q-qflist-out-of-range):
 *   - `jump_to_cell_line`: cell with the requested `execution_count` exists
 *     in `cellSourceRanges` AND K is within the source range. Otherwise the
 *     frame is skipped.
 *   - `jump_to_file`: always included; file existence is delegated to Vim's
 *     standard `:cnext` / `:cfirst` error if the file cannot be opened
 *     (same convention as `jumpToFile`).
 *
 * Sets the qflist via `setqflist(list, 'r', { title: 'Europa traceback' })`.
 * Does NOT call `:copen` — the user opens the window on their own (US3 AC2).
 *
 * The companion dispatcher RPC (`jumpToTracebackList`) carries the
 * `europa.dispatcher.jump-to-traceback-list` spec-id; this helper is the
 * shared view-layer body.
 */
export async function populateTracebackQflist(
  denops: Denops,
  bufnr: number,
  plan: RenderPlan,
  cwd: string,
  notebookSelector: (
    executionCount: number,
    line: number,
  ) =>
    | { actionable: true; sourceStartLine: number; sourceEndLine: number }
    | { actionable: false },
): Promise<void> {
  const entries: Array<Record<string, unknown>> = [];
  for (const c of plan.clickables) {
    if (c.action.type === "jump_to_cell_line") {
      const { executionCount, line: k } = c.action.payload;
      const res = notebookSelector(executionCount, k);
      if (!res.actionable) continue;
      entries.push({
        bufnr,
        lnum: res.sourceStartLine + k,
        col: 1,
        text: `Cell In[${executionCount}], line ${k}`,
        type: "E",
      });
    } else if (c.action.type === "jump_to_file") {
      const { path, line } = c.action.payload;
      const resolved = resolveFilePath(path, cwd);
      entries.push({
        filename: resolved,
        lnum: line,
        col: 1,
        text: `File ${path}:${line}`,
        type: "E",
      });
    }
  }
  // Neovim raises E475 "cannot have both a list and a 'what' argument"
  // when {list} is non-empty AND {what} is also supplied. Pass items
  // inside the what dict (items + title together) to avoid the conflict;
  // Vim accepts the same form.
  await denops.call("setqflist", [], "r", {
    title: "Europa traceback",
    items: entries,
  });
}

/**
 * Execute a `jump_to_file` action via `:split` in a new window.
 *
 * Path resolution per `resolveFilePath`. File existence is not validated —
 * Vim's `:split` raises `E:Cannot find file` interactively when the path
 * is missing (US2 AC3).
 *
 * @spec-id europa.view.traceback-jump.external-file
 */
export async function jumpToFile(
  denops: Denops,
  kernelCwd: string,
  action: { payload: { path: string; line: number } },
): Promise<void> {
  const resolved = resolveFilePath(action.payload.path, kernelCwd);
  const escaped = await denops.call("fnameescape", resolved) as string;
  await denops.cmd(`split ${escaped}`);
  await denops.cmd(
    `call setpos('.', [bufnr('%'), ${action.payload.line}, 1, 0])`,
  );
  await denops.cmd("normal! zz");
}
