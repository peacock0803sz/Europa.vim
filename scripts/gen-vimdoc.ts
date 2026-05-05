/**
 * Europa.vim API reference generator.
 *
 * Pipeline:
 *   1. typedoc (typedoc-plugin-markdown) → tmp/typedoc/
 *   2. concat-md.ts → tmp/api-reference.md  (Modules → Classes → Functions → Types)
 *   3. tmp/api-reference.md → doc/europa-api.txt
 *
 * The hand-written guide chapters live as `doc/europa-<slug>.txt` and are
 * shipped as standalone help files; this script no longer aggregates them.
 * Only the API reference is auto-generated, so every other doc file under
 * `doc/` is a hand-edited source of truth.
 *
 * typedoc errors are fatal. The pipeline still writes `doc/europa-api.txt`
 * with whatever apiBody is available (possibly empty) so the file remains
 * present for `:helptags`, but the task exits non-zero so CI surfaces missing
 * or broken API reference output.
 *
 * panvimdoc (Lua/pandoc filter) is deferred to Phase 3 when it will be
 * available in the nix dev shell.
 *
 * @module scripts/gen-vimdoc
 */

import { generate as runConcatMd } from "./concat-md.ts";

const OUTPUT_PATH = "doc/europa-api.txt";
const API_REFERENCE_PATH = "tmp/api-reference.md";

/**
 * Build the canonical API reference vimdoc body.
 *
 * The output is a single help file with `*europa-api.txt*` as the file tag,
 * `*europa-api*` as the primary navigation tag, and a trailing modeline so
 * end-of-file-fixer stays happy and re-running yields a zero diff.
 */
function buildVimdoc(apiBody: string): string {
  const header = "*europa-api.txt*\teuropa.vim API reference\n";
  const apiSection =
    "==============================================================================\nAPI REFERENCE\t\t\t\t\t\t\t*europa-api*\n\n" +
    (apiBody.length > 0
      ? apiBody
      : "(generated from TSDoc; populated in Phase 2+)\n");
  const modeline = "vim:tw=78:ts=8:noet:ft=help:norl:\n";
  return [header, apiSection, modeline].join("\n");
}

/**
 * Read the concatenated API Reference markdown produced by concat-md.ts.
 *
 * Phase 1 returns an empty string because typedoc has not been wired yet, so
 * `tmp/api-reference.md` is empty after concat-md runs. Phase 2 will populate
 * this via typedoc + concat-md chapter ordering.
 */
async function readApiReference(): Promise<string> {
  try {
    return await Deno.readTextFile(API_REFERENCE_PATH);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
}

/**
 * Run typedoc to populate `tmp/typedoc/` for the API reference.
 *
 * Returns `true` on success and `false` when typedoc exits non-zero. The
 * caller is responsible for translating a `false` result into a non-zero task
 * exit so CI catches the regression.
 */
async function runTypedoc(): Promise<boolean> {
  await Deno.remove("tmp/typedoc", { recursive: true }).catch(() => {});
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "npm:typedoc",
      "--options",
      "typedoc.json",
      "--out",
      "tmp/typedoc",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) {
    console.error(
      `[gen-vimdoc] typedoc exited with status ${code} — see errors above.`,
    );
    return false;
  }
  return true;
}

/**
 * Generate `doc/europa-api.txt` deterministically from current TSDoc.
 *
 * @example
 * ```sh
 * deno task gen:vimdoc
 * ```
 */
export async function generate(): Promise<void> {
  const typedocOk = await runTypedoc();
  await runConcatMd();
  const apiBody = await readApiReference();
  const body = buildVimdoc(apiBody);
  await Deno.writeTextFile(OUTPUT_PATH, body);
  if (!typedocOk) {
    throw new Error("typedoc failed — API reference is empty");
  }
}

if (import.meta.main) {
  await generate();
}
