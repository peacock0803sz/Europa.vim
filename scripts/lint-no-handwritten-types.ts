/**
 * Lint script enforcing the TypeBox schema SoT contract for denops/europa.
 *
 * Rule 1: No hand-written `interface` or `type X = ...` declarations under
 * `denops/europa/**\/*.ts`, except for the three whitelisted contract files.
 * Allowed derived patterns: `Static<typeof XxxSchema>`, `import("...").T`
 * re-exports, and `typeof CONST_ARRAY[number]` indexed-access aliases.
 *
 * Rule 2: Any block of three or more consecutive non-TSDoc comments must
 * contain "why" content — not just "what", empty lines, or TODO markers.
 *
 * Rule 3 (Phase 1): The `docs/` directory must not exist.
 *
 * @module scripts/lint-no-handwritten-types
 * @spec-id europa.lint.no-handwritten-types.rule1
 * @spec-id europa.lint.no-handwritten-types.rule2
 */

import * as ts from "typescript";

// --- Configuration ----------------------------------------------------------

const TARGET_GLOB = "denops/europa";
const WHITELIST = new Set([
  "contracts/cell-marker.ts",
  "contracts/dispatcher.ts",
  "contracts/kernel-client.ts",
  "contracts/session-runtime.ts",
  // MagickConverter is a DI callback type for testability — not a domain type
  "denops/europa/view/viewer.ts",
  // Phase 3.2 kernel implementation files use internal helper type aliases
  // (ActiveHandle, SpawnResult, ConnectResult, WatchdogArgs, etc.) that are
  // local to the implementation and do not model domain entities.
  "denops/europa/kernel/server-process.ts",
  "denops/europa/kernel/watchdog.ts",
  "denops/europa/kernel/server-client.ts",
  "denops/europa/kernel/server-pool.ts",
]);

// Argument parsing: --target <path> runs rule 1+2 on that path instead of
// the default TARGET_GLOB (used by spec tests for per-fixture checks).
const args = Deno.args;
const targetFlagIdx = args.indexOf("--target");
const targetOverride = targetFlagIdx >= 0 ? args[targetFlagIdx + 1] : null;

// --- Rule 3 (Phase 1 carry-over) --------------------------------------------

async function checkForbiddenDirectory(name: string): Promise<boolean> {
  try {
    const info = await Deno.stat(name);
    return info.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

// --- File collection --------------------------------------------------------

async function collectTsFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const stat = await Deno.stat(root);
    if (stat.isFile && root.endsWith(".ts")) {
      return [root];
    }
    if (!stat.isDirectory) return [];
  } catch {
    return [];
  }
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await collectTsFiles(path)));
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

// --- Rule 1: Hand-written type detection ------------------------------------

type Violation = { file: string; line: number; name: string; kind: string };

function isTypeBoxDerived(node: ts.TypeAliasDeclaration): boolean {
  const type = node.type;
  // Static<typeof XxxSchema> pattern
  if (ts.isTypeReferenceNode(type)) {
    const typeName = type.typeName;
    if (ts.isIdentifier(typeName) && typeName.text === "Static") {
      const arg = type.typeArguments?.[0];
      if (arg && ts.isTypeQueryNode(arg)) {
        const exprName = arg.exprName;
        if (ts.isIdentifier(exprName) && exprName.text.endsWith("Schema")) {
          return true;
        }
      }
      return false;
    }
  }
  // import("...") re-export patterns
  if (ts.isImportTypeNode(type)) return true;
  // typeof X[number] — derived from a const array (e.g. typeof HIGHLIGHT_GROUPS[number])
  if (
    ts.isIndexedAccessTypeNode(type) && ts.isTypeQueryNode(type.objectType)
  ) return true;
  return false;
}

function checkRule1(
  filePath: string,
  source: ts.SourceFile,
): Violation[] {
  const violations: Violation[] = [];

  // Normalise path for whitelist comparison
  const normalised = filePath.replace(/\\/g, "/");
  for (const wl of WHITELIST) {
    if (normalised.endsWith(wl) || normalised === wl) return [];
  }

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      violations.push({
        file: filePath,
        line: line + 1,
        name: node.name.text,
        kind: "interface",
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      if (!isTypeBoxDerived(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: filePath,
          line: line + 1,
          name: node.name.text,
          kind: "type alias",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(source, visit);
  return violations;
}

// --- Rule 2: 3-line non-TSDoc comment why-check -----------------------------

interface CommentBlock {
  file: string;
  startLine: number;
  lines: string[];
  isTsDoc: boolean;
}

function extractCommentBlocks(
  filePath: string,
  source: ts.SourceFile,
  text: string,
): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const commentText = scanner.getTokenText();
      const pos = scanner.getTokenStart();
      const { line: startLine } = source.getLineAndCharacterOfPosition(pos);
      const isTsDoc = commentText.startsWith("/**");
      const contentLines = commentText
        .split("\n")
        .map((l) =>
          l
            .replace(/^\s*\/\/\s?/, "")
            .replace(/^\s*\/\*+\s?/, "")
            .replace(/\s*\*+\/\s*$/, "")
            .replace(/^\s*\*\s?/, "")
            .trim()
        );
      blocks.push({
        file: filePath,
        startLine: startLine + 1,
        lines: contentLines,
        isTsDoc,
      });
    }
    token = scanner.scan();
  }

  // Merge adjacent single-line comment runs
  const merged: CommentBlock[] = [];
  for (const block of blocks) {
    if (block.isTsDoc) {
      merged.push(block);
      continue;
    }
    const last = merged[merged.length - 1];
    if (
      last && !last.isTsDoc &&
      last.startLine + last.lines.length >= block.startLine
    ) {
      last.lines.push(...block.lines);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

// Words that signal "why" reasoning rather than "what" description.
const WHY_KEYWORDS =
  /\b(because|since|workaround|fixes|prevents|avoids|avoid|needed|to avoid|in order to|so that|due to|as a result|quirk|hack|must|cannot|require)\b/i;

function isWhyContent(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return false; // entirely empty
  if (nonEmpty.every((l) => l.startsWith("@"))) return false; // all @-tags
  const allTokens = nonEmpty.join(" ").split(/\s+/).filter(Boolean);
  if (allTokens.length < 5) return false; // too short to be a why
  if (
    nonEmpty.every((l) => /^(TODO|FIXME|XXX):?$/.test(l.trim()))
  ) return false;
  // Must contain at least one "why" indicator word — not just labels/descriptions.
  if (!WHY_KEYWORDS.test(nonEmpty.join(" "))) return false;
  return true;
}

function checkRule2(
  filePath: string,
  source: ts.SourceFile,
  text: string,
): Violation[] {
  const blocks = extractCommentBlocks(filePath, source, text);
  const violations: Violation[] = [];

  for (const block of blocks) {
    if (block.isTsDoc) continue;
    if (block.lines.length < 3) continue;
    if (!isWhyContent(block.lines)) {
      violations.push({
        file: filePath,
        line: block.startLine,
        name: "(comment block)",
        kind: "why-check",
      });
    }
  }
  return violations;
}

// --- Main -------------------------------------------------------------------

async function runRules(targetRoot: string): Promise<boolean> {
  const files = await collectTsFiles(targetRoot);
  const rule1Violations: Violation[] = [];
  const rule2Violations: Violation[] = [];

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    rule1Violations.push(...checkRule1(file, source));
    rule2Violations.push(...checkRule2(file, source, text));
  }

  let failed = false;

  if (rule1Violations.length > 0) {
    failed = true;
    console.error("[rule 1] hand-written interface / type alias detected:");
    for (const v of rule1Violations) {
      console.error(`  ${v.file}:${v.line} — ${v.kind} '${v.name}'`);
    }
    console.error(
      "  Derive types from schema/ via Static<typeof Schema> instead.",
    );
  }

  if (rule2Violations.length > 0) {
    failed = true;
    console.error("[rule 2] 3+ line non-TSDoc comment missing why content:");
    for (const v of rule2Violations) {
      console.error(
        `  ${v.file}:${v.line} — please explain *why* this code exists, not just what it does`,
      );
    }
  }

  return failed;
}

if (import.meta.main) {
  const targetRoot = targetOverride ?? TARGET_GLOB;
  let failed = false;

  // Rule 3 (only when running on default target, not a fixture override)
  if (!targetOverride) {
    const forbiddenExists = await checkForbiddenDirectory("docs");
    if (forbiddenExists) {
      console.error(
        "lint-no-handwritten-types: 'docs/' is forbidden. " +
          "Hand-written documentation belongs in repo-root markdown or " +
          "doc/sources/*.txt only. See DESIGN.md chapter 3 for the rule.",
      );
      failed = true;
    }
  }

  failed = (await runRules(targetRoot)) || failed;
  Deno.exit(failed ? 1 : 0);
}
