/**
 * BDD specs for concat-md.ts chapter ordering.
 *
 * @spec-id europa.lint.concat-md.chapter-order
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const SCRIPT = new URL(
  "../../scripts/concat-md.ts",
  import.meta.url,
).pathname;

async function runConcatMd(
  typedocDir: string,
  outputPath: string,
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      SCRIPT,
      "--typedoc-dir",
      typedocDir,
      "--output",
      outputPath,
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

describe("concat-md chapter ordering", () => {
  let tmpDir: string;
  let outputPath: string;

  beforeEach(async () => {
    tmpDir = await Deno.makeTempDir({ prefix: "concat-md-test-" });
    outputPath = join(tmpDir, "api-reference.md");
    // Create Modules, Classes, Functions, Types subdirectories
    for (const section of ["modules", "classes", "functions", "types"]) {
      await Deno.mkdir(join(tmpDir, section), { recursive: true });
    }
  });

  afterEach(async () => {
    await Deno.remove(tmpDir, { recursive: true });
  });

  it("outputs Modules before Classes before Functions before Types", async () => {
    await Deno.writeTextFile(
      join(tmpDir, "modules", "notebook.md"),
      "# Module: notebook\n\ncontent\n",
    );
    await Deno.writeTextFile(
      join(tmpDir, "classes", "SessionStore.md"),
      "# Class: SessionStore\n\ncontent\n",
    );
    await Deno.writeTextFile(
      join(tmpDir, "functions", "parseNotebook.md"),
      "# Function: parseNotebook\n\ncontent\n",
    );
    await Deno.writeTextFile(
      join(tmpDir, "types", "Notebook.md"),
      "# Type: Notebook\n\ncontent\n",
    );

    const { code, stderr } = await runConcatMd(tmpDir, outputPath);
    assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);

    const output = await Deno.readTextFile(outputPath);
    const modulesIdx = output.indexOf("## Modules");
    const classesIdx = output.indexOf("## Classes");
    const functionsIdx = output.indexOf("## Functions");
    const typesIdx = output.indexOf("## Types");

    assertEquals(
      modulesIdx < classesIdx,
      true,
      "Modules section must precede Classes",
    );
    assertEquals(
      classesIdx < functionsIdx,
      true,
      "Classes section must precede Functions",
    );
    assertEquals(
      functionsIdx < typesIdx,
      true,
      "Functions section must precede Types",
    );
  });

  it("produces a stable idempotent output (running twice gives the same result)", async () => {
    await Deno.writeTextFile(
      join(tmpDir, "functions", "foo.md"),
      "# Function: foo\n\ncontent\n",
    );

    await runConcatMd(tmpDir, outputPath);
    const first = await Deno.readTextFile(outputPath);
    await runConcatMd(tmpDir, outputPath);
    const second = await Deno.readTextFile(outputPath);

    assertEquals(first, second, "concat-md output must be idempotent");
  });
});
