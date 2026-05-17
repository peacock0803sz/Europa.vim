/**
 * Validates that all golden `.ipynb` fixtures conform to the
 * pre-normalize notebook schema (FR-064).
 *
 * Reads every `tests/golden/ipynb/*.ipynb`, JSON-parses it, and runs
 * `Value.Check(NotebookSchemaPreNormalize, raw)`. Any failure is reported
 * with the file path and the first five TypeBox errors, then the script
 * exits 1.
 *
 * @module scripts/validate-fixtures
 */

import { Value } from "@sinclair/typebox/value";
import { NotebookSchemaPreNormalize } from "../schema/notebook.ts";

const GOLDEN_DIR = "tests/golden/ipynb";
const FIXTURES_DIR = "tests/fixtures/ipynb";

async function collectIpynb(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".ipynb")) {
        files.push(`${dir}/${entry.name}`);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  files.sort();
  return files;
}

if (import.meta.main) {
  const files = [
    ...await collectIpynb(GOLDEN_DIR),
    ...await collectIpynb(FIXTURES_DIR),
  ];
  let failed = false;

  for (const file of files) {
    let raw: unknown;
    try {
      const text = await Deno.readTextFile(file);
      raw = JSON.parse(text);
    } catch (err) {
      console.error(`validate-fixtures: failed to parse ${file}: ${err}`);
      failed = true;
      continue;
    }

    if (!Value.Check(NotebookSchemaPreNormalize, raw)) {
      failed = true;
      const errors = [...Value.Errors(NotebookSchemaPreNormalize, raw)].slice(
        0,
        5,
      );
      console.error(`validate-fixtures: FAIL ${file}`);
      for (const e of errors) {
        console.error(`  [${e.path}] ${e.message}`);
      }
    } else {
      console.log(`validate-fixtures: OK ${file}`);
    }
  }

  if (files.length === 0) {
    console.log(`validate-fixtures: no .ipynb files found in ${GOLDEN_DIR}`);
  }

  Deno.exit(failed ? 1 : 0);
}
