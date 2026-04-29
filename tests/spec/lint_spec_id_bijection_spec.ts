/**
 * BDD specs for lint-spec-id-bijection.ts.
 *
 * @spec-id europa.lint.spec-id-bijection.bijection
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

const SCRIPT = new URL(
  "../../scripts/lint-spec-id-bijection.ts",
  import.meta.url,
).pathname;

const FIXTURES_DIR = new URL(
  "../../tests/fixtures/spec-id-fixtures",
  import.meta.url,
).pathname;

async function runBijectionLint(
  specRoot: string,
  implRoot: string,
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      SCRIPT,
      "--spec-root",
      specRoot,
      "--impl-root",
      implRoot,
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

describe("lint-spec-id-bijection (@spec-id bijection check)", () => {
  it("passes when spec and impl @spec-ids match 1:1", async () => {
    const specRoot = FIXTURES_DIR + "/tests/spec";
    const implRoot = FIXTURES_DIR + "/denops/europa";
    const { code, stderr } = await runBijectionLint(specRoot, implRoot);
    assertEquals(
      code,
      0,
      `expected 0 for matching fixtures, got ${code}; stderr: ${stderr}`,
    );
  });

  it("exits 1 when spec has an id missing from impl", async () => {
    // Spec fixture has europa.notebook.parse.normalize but impl dir is empty
    const specRoot = FIXTURES_DIR + "/tests/spec";
    const emptyImplRoot = await Deno.makeTempDir();
    try {
      const { code } = await runBijectionLint(specRoot, emptyImplRoot);
      assertEquals(code, 1, "missing impl-side id should exit 1");
    } finally {
      await Deno.remove(emptyImplRoot, { recursive: true });
    }
  });

  it("exits 1 when an area is not in the allowlist", async () => {
    const specRoot = await Deno.makeTempDir();
    const implRoot = await Deno.makeTempDir();
    try {
      const invalidId = "europa.bogusarea.topic";
      const tsdoc = `/**\n * @spec-id ${invalidId}\n */\n`;
      await Deno.writeTextFile(`${specRoot}/bogus_spec.ts`, tsdoc);
      await Deno.writeTextFile(`${implRoot}/bogus.ts`, tsdoc);

      const { code, stderr } = await runBijectionLint(specRoot, implRoot);
      assertEquals(
        code,
        1,
        `invalid allowlist area should exit 1; stderr: ${stderr}`,
      );
    } finally {
      await Deno.remove(specRoot, { recursive: true });
      await Deno.remove(implRoot, { recursive: true });
    }
  });
});
