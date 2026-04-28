/**
 * Europa.vim vimdoc generator.
 *
 * Phase 0: emit a deterministic, idempotent `doc/europa.txt` from any sources
 * found under `doc/sources/` and the typedoc API reference (both empty in this
 * phase). Phase 1+ will swap the static body for pandoc + panvimdoc Lua filter
 * output configured via `panvimdoc.json`.
 *
 * @module scripts/gen-vimdoc
 */

const SOURCES_DIR = "doc/sources";
const OUTPUT_PATH = "doc/europa.txt";

/**
 * Read every `.txt` file under `doc/sources/` in lexicographic order and
 * concatenate their contents.
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
      parts.push(await Deno.readTextFile(`${SOURCES_DIR}/${name}`));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return parts.join("\n");
}

/**
 * Build the canonical Phase 0 vimdoc body.
 *
 * Order is fixed: header line → guide chapters from `doc/sources/` → API
 * Reference placeholder → modeline. The output ends with a trailing newline
 * so end-of-file-fixer stays happy and re-running yields a zero diff.
 */
function buildVimdoc(sourcesBody: string, apiBody: string): string {
  const header = "*europa.txt*\teuropa.vim documentation\n";
  const apiSection =
    "==============================================================================\nAPI REFERENCE\t\t\t\t\t\t\t*europa-api*\n\n" +
    (apiBody.length > 0
      ? apiBody
      : "(generated from TSDoc; populated in Phase 1+)\n");
  const guideSection = sourcesBody.length > 0
    ? sourcesBody
    : "(guide chapters land in doc/sources/ during Phase 1)\n";
  const modeline = "vim:tw=78:ts=8:noet:ft=help:norl:\n";
  return [header, guideSection, apiSection, modeline].join("\n");
}

/**
 * Generate `doc/europa.txt` from current sources and write it atomically.
 *
 * @example
 * ```sh
 * deno task gen:vimdoc
 * ```
 */
export async function generate(): Promise<void> {
  const sourcesBody = await readSources();
  const apiBody = "";
  const body = buildVimdoc(sourcesBody, apiBody);
  await Deno.writeTextFile(OUTPUT_PATH, body);
}

if (import.meta.main) {
  await generate();
}
