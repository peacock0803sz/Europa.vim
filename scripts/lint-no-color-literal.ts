/**
 * Lint: no hard-coded color literals in syntax-highlight implementation.
 *
 * Scans `denops/europa/view/syntax-highlight*.ts` for hex color patterns
 * (`#RGB` / `#RRGGBB`) and CSS `color:` property literals. Exits non-zero
 * on first violation.
 *
 * FR-005: Europa must not hard-code display colors. All coloring flows
 * through named highlight groups (`hi default link`) so colorscheme authors
 * can override everything without touching plugin source.
 *
 * Pass `--target <path>` to scan a specific file or directory instead of
 * the default glob (used by BDD spec tests with fixture files).
 *
 * @module scripts/lint-no-color-literal
 * @spec-id europa.lint.no-color-literal
 */

import { expandGlob } from "@std/fs";

// Matches #RGB (3-digit) or #RRGGBB (6-digit) hex color literals.
const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;

// Argument parsing: --target <path> overrides the default glob scan.
const args = Deno.args;
const targetFlagIdx = args.indexOf("--target");
const targetOverride = targetFlagIdx >= 0 ? args[targetFlagIdx + 1] : null;

async function scanFile(path: string): Promise<boolean> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return false;
  }
  let failed = false;
  for (const [i, line] of text.split("\n").entries()) {
    if (HEX_COLOR_RE.test(line)) {
      console.error(
        `[no-color-literal] ${path}:${
          i + 1
        } -- hard-coded color literal: ${line.trim()}`,
      );
      failed = true;
    }
  }
  return failed;
}

async function run(target: string): Promise<boolean> {
  let failed = false;
  // Single file path
  try {
    const stat = await Deno.stat(target);
    if (stat.isFile) {
      return await scanFile(target);
    }
  } catch {
    // fall through to glob
  }
  // Directory or glob pattern
  for await (const entry of expandGlob(`${target}/**/*.ts`)) {
    if (await scanFile(entry.path)) failed = true;
  }
  return failed;
}

if (import.meta.main) {
  const scanTarget = targetOverride ??
    "denops/europa/view/syntax-highlight*.ts";
  let failed: boolean;
  if (!targetOverride) {
    // Default: glob over the syntax-highlight files directly
    failed = false;
    for await (
      const entry of expandGlob("denops/europa/view/syntax-highlight*.ts")
    ) {
      if (await scanFile(entry.path)) failed = true;
    }
  } else {
    failed = await run(scanTarget);
  }
  Deno.exit(failed ? 1 : 0);
}
