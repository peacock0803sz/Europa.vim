/**
 * concat-md scaffold for the API Reference generation pipeline.
 *
 * Phase 1 only wires the call. The script walks `tmp/typedoc/**\/*.md`,
 * which stays empty until typedoc lands in Phase 2, and writes the
 * concatenated body to `tmp/api-reference.md` without applying any chapter
 * order. Chapter ordering, Modules then Classes then Functions then Types,
 * is Phase 2 work.
 *
 * @module scripts/concat-md
 */

const TYPEDOC_DIR = "tmp/typedoc";
const OUTPUT_PATH = "tmp/api-reference.md";

// TODO(phase-2): order typedoc-plugin-markdown output by chapter. Modules
// come first, then Classes, then Functions, then Types. Within each category
// sort alphabetically and dispatch on `@module` and `@category` tags. Phase 1
// concatenates without ordering; once Phase 2 wires typedoc, the API Reference
// has to be deterministic, so ordering becomes mandatory.

async function collectMarkdown(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        files.push(...(await collectMarkdown(path)));
      } else if (entry.isFile && entry.name.endsWith(".md")) {
        files.push(path);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  files.sort();
  return files;
}

export async function generate(): Promise<void> {
  const files = await collectMarkdown(TYPEDOC_DIR);
  const parts: string[] = [];
  for (const path of files) {
    parts.push(await Deno.readTextFile(path));
  }
  await Deno.mkdir("tmp", { recursive: true });
  await Deno.writeTextFile(OUTPUT_PATH, parts.join("\n"));
}

if (import.meta.main) {
  await generate();
}
