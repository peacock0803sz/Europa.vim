/**
 * In-house lint scaffold enforcing the `docs/` prohibition.
 *
 * Phase 1 implements only the docs-directory rule. Hand-written documentation
 * never lives under `docs/`. The only allowed locations are repository-root
 * markdown such as `README.md`, `DESIGN.md`, `CONTRIBUTING.md`, and
 * `AGENTS.md`, plus any `doc/sources/*.txt` chapter. A filesystem check
 * covers this rule, so no AST traversal is needed.
 *
 * @module scripts/lint-no-handwritten-types
 */

// TODO(phase-2): rule 1 flags every `interface` or `type X = ...` declaration
// under `denops/europa/**/*.ts` that is not derived from TypeBox via
// `Static<typeof Schema>`. AST traversal with deno_ast or similar is required;
// a regex pass produces too many false positives on generics and conditional
// types. Hand-written types break the schema/ SoT contract.

// TODO(phase-2): rule 2 requires any run of three or more consecutive
// non-TSDoc comments to explain "why" rather than restate "what". TSDoc,
// which uses `/** */`, is exempt. The lint mechanises the why-only rule so
// reviewers do not have to police it by hand.

const FORBIDDEN_DIR = "docs";

async function checkForbiddenDirectory(name: string): Promise<boolean> {
  try {
    const info = await Deno.stat(name);
    return info.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

if (import.meta.main) {
  const exists = await checkForbiddenDirectory(FORBIDDEN_DIR);
  if (exists) {
    console.error(
      `lint-no-handwritten-types: '${FORBIDDEN_DIR}/' is forbidden. ` +
        "Hand-written documentation belongs in repo-root markdown or " +
        "doc/sources/*.txt only. See DESIGN.md chapter 3 for the rule.",
    );
    Deno.exit(1);
  }
}
