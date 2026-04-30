/**
 * Europa.vim vimdoc generator — Phase 2 pipeline.
 *
 * Pipeline:
 *   1. typedoc (typedoc-plugin-markdown) → tmp/typedoc/
 *   2. concat-md.ts → tmp/api-reference.md  (Modules → Classes → Functions → Types)
 *   3. doc/sources/*.txt + api-reference.md → doc/europa.txt
 *
 * typedoc errors are fatal. The pipeline still writes `doc/europa.txt` from
 * the source chapters that were read so the file stays in sync with
 * `doc/sources/`, but the task exits non-zero so CI surfaces missing or broken
 * API reference output.
 *
 * panvimdoc (Lua/pandoc filter) is deferred to Phase 3 when it will be
 * available in the nix dev shell.
 *
 * @module scripts/gen-vimdoc
 */

import { generate as runConcatMd } from "./concat-md.ts";

const SOURCES_DIR = "doc/sources";
const OUTPUT_PATH = "doc/europa.txt";
const API_REFERENCE_PATH = "tmp/api-reference.md";
// Each `doc/sources/*.txt` carries its own vim help modeline so the file is
// edit-friendly on its own; strip it before concatenating so the aggregated
// `doc/europa.txt` ends up with the single modeline that `buildVimdoc`
// appends, not one per chapter.
const TRAILING_MODELINE = /\n+vim:[^\n]*\n*$/;

function stripTrailingModeline(text: string): string {
  return text.replace(TRAILING_MODELINE, "\n");
}

/**
 * Read every `.txt` file under `doc/sources/` in lexicographic order and
 * concatenate their contents, dropping each file's trailing modeline so the
 * aggregated output keeps only the canonical one added by `buildVimdoc`.
 *
 * @returns Concatenated source body, or an empty string if no sources exist.
 */
async function readSources(): Promise<string> {
  const parts: string[] = [];
  try {
    const names: string[] = [];
    for await (const entry of Deno.readDir(SOURCES_DIR)) {
      if (entry.isFile && entry.name.endsWith(".txt")) names.push(entry.name);
    }
    names.sort();
    for (const name of names) {
      const text = await Deno.readTextFile(`${SOURCES_DIR}/${name}`);
      parts.push(stripTrailingModeline(text));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return parts.join("\n");
}

/**
 * Build the canonical Phase 0 vimdoc body.
 *
 * The order is fixed. The header line comes first, then guide chapters from
 * `doc/sources/`, then the API Reference placeholder, then the modeline. The
 * output ends with a trailing newline so end-of-file-fixer stays happy and
 * re-running yields a zero diff.
 */
function buildVimdoc(sourcesBody: string, apiBody: string): string {
  const header = "*europa.txt*\teuropa.vim documentation\n";
  const apiSection =
    "==============================================================================\nAPI REFERENCE\t\t\t\t\t\t\t*europa-api*\n\n" +
    (apiBody.length > 0
      ? apiBody
      : "(generated from TSDoc; populated in Phase 2+)\n");
  const guideSection = sourcesBody.length > 0
    ? sourcesBody
    : "(guide chapters land in doc/sources/ during Phase 1)\n";
  const modeline = "vim:tw=78:ts=8:noet:ft=help:norl:\n";
  return [header, guideSection, apiSection, modeline].join("\n");
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
 * Generate `doc/europa.txt` deterministically from current sources.
 *
 * @example
 * ```sh
 * deno task gen:vimdoc
 * ```
 */
export async function generate(): Promise<void> {
  const typedocOk = await runTypedoc();
  await runConcatMd();
  const sourcesBody = await readSources();
  const apiBody = await readApiReference();
  const body = buildVimdoc(sourcesBody, apiBody);
  await Deno.writeTextFile(OUTPUT_PATH, body);
  if (!typedocOk) {
    throw new Error("typedoc failed — API reference is empty");
  }
}

if (import.meta.main) {
  await generate();
}
