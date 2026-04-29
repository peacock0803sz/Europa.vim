/**
 * API Reference assembler for the gen-vimdoc pipeline.
 *
 * Walks the `tmp/typedoc/` directory tree produced by typedoc-plugin-markdown
 * and emits `tmp/api-reference.md` with sections ordered:
 *   Modules → Classes → Functions → Types
 *
 * Within each section files are sorted alphabetically. `# Module: ...`-style
 * headings are demoted to `##` so they nest cleanly under the section header.
 *
 * Accepts optional CLI overrides for testing:
 *   --typedoc-dir <path>  default: tmp/typedoc
 *   --output <path>       default: tmp/api-reference.md
 *
 * @module scripts/concat-md
 * @spec-id europa.lint.concat-md.chapter-order
 */

const SECTION_ORDER = ["modules", "classes", "functions", "types"] as const;
const SECTION_TITLES: Record<typeof SECTION_ORDER[number], string> = {
  modules: "Modules",
  classes: "Classes",
  functions: "Functions",
  types: "Types",
};

// --- Argument parsing -------------------------------------------------------

const args = Deno.args;
function flagValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] ?? null : null;
}

const TYPEDOC_DIR = flagValue("--typedoc-dir") ?? "tmp/typedoc";
const OUTPUT_PATH = flagValue("--output") ?? "tmp/api-reference.md";

// --- File collection --------------------------------------------------------

async function collectSection(sectionDir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(sectionDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        files.push(`${sectionDir}/${entry.name}`);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  files.sort();
  return files;
}

// --- Heading demotion -------------------------------------------------------

function demoteTopHeadings(text: string): string {
  // `# Heading` → `## Heading` (one level down for section nesting)
  return text.replace(/^# /gm, "## ");
}

// --- Main -------------------------------------------------------------------

export async function generate(
  typedocDir = TYPEDOC_DIR,
  outputPath = OUTPUT_PATH,
): Promise<void> {
  const sections: string[] = [];

  for (const section of SECTION_ORDER) {
    const sectionDir = `${typedocDir}/${section}`;
    const files = await collectSection(sectionDir);
    if (files.length === 0) continue;

    const title = SECTION_TITLES[section];
    sections.push(`## ${title}`);

    for (const file of files) {
      const raw = await Deno.readTextFile(file);
      sections.push(demoteTopHeadings(raw.trim()));
    }
  }

  await Deno.mkdir("tmp", { recursive: true });
  const output = sections.join("\n\n") + (sections.length > 0 ? "\n" : "");
  await Deno.writeTextFile(outputPath, output);
}

if (import.meta.main) {
  await generate();
}
