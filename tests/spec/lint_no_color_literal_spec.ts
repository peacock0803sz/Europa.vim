/**
 * BDD specs for scripts/lint-no-color-literal.ts.
 *
 * Guards FR-005: Europa must not hard-code display colors in
 * syntax-highlight implementation files; all coloring must go through
 * named highlight groups so colorschemes can override everything.
 *
 * @spec-id europa.lint.no-color-literal
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

const SCRIPT = new URL(
  "../../scripts/lint-no-color-literal.ts",
  import.meta.url,
).pathname;

const FIXTURES = new URL(
  "../../tests/fixtures/lint-fixtures",
  import.meta.url,
).pathname;

async function runLint(
  target: string,
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      SCRIPT,
      "--target",
      target,
    ],
    stderr: "piped",
    stdout: "null",
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("lint-no-color-literal (europa.lint.no-color-literal)", () => {
  it("exits 1 when a hex color literal is found (FR-005 guard)", async () => {
    const { code } = await runLint(FIXTURES + "/bad-color-literal.ts");
    assertEquals(code, 1, "expected exit 1 for file with hex color literal");
  });

  it("exits 0 when no color literals are present", async () => {
    const { code } = await runLint(FIXTURES + "/good-no-color.ts");
    assertEquals(code, 0, "expected exit 0 for file without color literals");
  });
});
