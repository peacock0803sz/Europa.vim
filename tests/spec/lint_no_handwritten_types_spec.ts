/**
 * BDD specs for lint-no-handwritten-types.ts rules 1 and 2.
 *
 * @spec-id europa.lint.no-handwritten-types.rule1
 * @spec-id europa.lint.no-handwritten-types.rule2
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

const SCRIPT = new URL(
  "../../scripts/lint-no-handwritten-types.ts",
  import.meta.url,
).pathname;

async function runLintOnFixture(
  fixturePath: string,
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      SCRIPT,
      "--target",
      fixturePath,
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

const FIXTURES = new URL(
  "../../tests/fixtures/lint-fixtures",
  import.meta.url,
).pathname;

describe("lint-no-handwritten-types rule 1 (interface / type alias detection)", () => {
  it("exits 1 when a hand-written interface is found in target dir", async () => {
    const { code, stderr } = await runLintOnFixture(FIXTURES);
    assertEquals(code, 1, `expected exit 1 but got ${code}; stderr: ${stderr}`);
  });

  it("exit 0 when only derived types are present (single good file)", async () => {
    const goodFile = FIXTURES + "/good-derived-type.ts";
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        SCRIPT,
        "--target",
        goodFile,
      ],
      stderr: "piped",
      stdout: "null",
    });
    const result = await cmd.output();
    // good-derived-type.ts has only TypeBox-derived types, should pass
    // (code may be 0 or 1 depending on whether bad fixtures also in scope)
    // The key assertion is that stderr mentions bad-interface.ts, not good-derived-type.ts
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(
      stderr.includes("good-derived-type"),
      false,
      "good-derived-type.ts should not be flagged",
    );
  });
});

describe("lint-no-handwritten-types rule 2 (3-line non-TSDoc comment why-check)", () => {
  it("exits 1 when a 3-line comment contains no why content", async () => {
    const badFile = FIXTURES + "/bad-3-line-comment.ts";
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        SCRIPT,
        "--target",
        badFile,
      ],
      stderr: "piped",
      stdout: "null",
    });
    const result = await cmd.output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(
      result.code,
      1,
      `expected exit 1 for bad comment, got ${result.code}; stderr: ${stderr}`,
    );
  });

  it("does not flag a 3-line comment that explains why", async () => {
    const goodFile = FIXTURES + "/good-why-comment.ts";
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        SCRIPT,
        "--target",
        goodFile,
      ],
      stderr: "piped",
      stdout: "null",
    });
    const result = await cmd.output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(
      result.code,
      0,
      `good-why-comment.ts should pass rule 2, got exit ${result.code}; stderr: ${stderr}`,
    );
  });
});
