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
  Clickable,
  Highlight,
  RenderPlan,
} from "../../../schema/render-plan.ts";

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
