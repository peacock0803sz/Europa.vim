/**
 * Lint script: verify that plugin/mappings.vim contains only
 * `<Plug>(europa-*)` mappings and no concrete key bindings.
 *
 * Exits 0 when all map lhs values start with `<Plug>(europa-`.
 * Exits 1 and prints violations otherwise.
 *
 * Usage:
 *   deno run --allow-read scripts/lint-no-default-mappings.ts [path]
 *
 * The optional [path] argument overrides the default
 * `plugin/mappings.vim` location (useful in tests).
 *
 * @module scripts/lint-no-default-mappings
 * @spec-id europa.lint.no-default-mappings
 */

/** Vim map command prefix pattern. */
const MAP_CMD_RE = /^\s*([nvixsoclt]?(?:no)?(?:re)?map!?)\s+/;

/** Map option tokens: <silent>, <buffer>, <expr>, <nowait>, <unique>, etc. */
const MAP_OPT_RE = /^<(?:silent|buffer|expr|nowait|unique|script|special)>/i;

export type Violation = { lineNo: number; line: string; lhs: string };

/**
 * Parse all map lines from a Vimscript string.
 * Returns violations whose lhs does not start with `<Plug>(europa-`.
 */
export function findDefaultMappingViolations(content: string): Violation[] {
  const violations: Violation[] = [];
  for (const [idx, rawLine] of content.split("\n").entries()) {
    const mapMatch = MAP_CMD_RE.exec(rawLine);
    if (!mapMatch) continue;
    let rest = rawLine.slice(mapMatch[0].length).trimStart();
    while (MAP_OPT_RE.test(rest)) {
      rest = rest.slice(rest.indexOf(">") + 1).trimStart();
    }
    const lhsMatch = /^\S+/.exec(rest);
    if (!lhsMatch) continue;
    const lhs = lhsMatch[0];
    if (!lhs.startsWith("<Plug>(europa-")) {
      violations.push({ lineNo: idx + 1, line: rawLine, lhs });
    }
  }
  return violations;
}

if (import.meta.main) {
  const filePath = Deno.args[0] ?? "plugin/mappings.vim";
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch (e) {
    console.error(
      `lint-no-default-mappings: cannot read ${filePath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    Deno.exit(1);
  }
  const violations = findDefaultMappingViolations(content);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(
        `${filePath}:${v.lineNo}: non-Plug lhs '${v.lhs}' — ${v.line}`,
      );
    }
    Deno.exit(1);
  }
}
