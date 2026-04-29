/**
 * Europa.vim vimdoc generator.
 *
 * Phase 0 emits a deterministic, idempotent `doc/europa.txt` from whatever
 * sources exist under `doc/sources/` and the typedoc API reference, both
 * empty in that phase. Phase 1 wires `scripts/concat-md.ts` into the API
 * Reference path, so Phase 2 can replace the passthrough scaffold with
 * chapter-ordered output without touching this file. The pandoc plus
 * panvimdoc Lua filter pipeline configured through `panvimdoc.json` is
 * planned for later phases.
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
 * Generate `doc/europa.txt` deterministically from current sources.
 *
 * @example
 * ```sh
 * deno task gen:vimdoc
 * ```
 */
export async function generate(): Promise<void> {
  await runConcatMd();
  const sourcesBody = await readSources();
  const apiBody = await readApiReference();
  const body = buildVimdoc(sourcesBody, apiBody);
  await Deno.writeTextFile(OUTPUT_PATH, body);
}

if (import.meta.main) {
  await generate();
}
