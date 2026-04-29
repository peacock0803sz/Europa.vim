/**
 * Notebook parser: JSON → normalized Notebook.
 *
 * Phase 2 Foundational stub — full implementation lands in US1 (T049).
 *
 * The parse pipeline:
 *   1. JSON.parse
 *   2. Value.Check(NotebookSchemaPreNormalize) — pre-normalize validation
 *   3. Normalize: string[] source → string, missing cell.id → uuid v4
 *   4. Value.Check(NotebookSchema) — post-normalize validation
 *   5. Throw NotebookParseError on failure
 *
 * @category Notebook
 */

import { Value } from "@sinclair/typebox/value";
import {
  type Notebook,
  NotebookSchema,
  NotebookSchemaPreNormalize,
} from "../../../schema/notebook.ts";

/** Thrown when a `.ipynb` file fails pre- or post-normalize validation. */
export class NotebookParseError extends Error {
  constructor(
    message: string,
    public readonly typeBoxErrors: unknown[],
    public readonly path?: string,
  ) {
    super(`NotebookParseError: ${message}`);
    this.name = "NotebookParseError";
  }
}

/**
 * Parse and normalize a raw `.ipynb` JSON string into a `Notebook`.
 *
 * @param content - Raw JSON string from a `.ipynb` file.
 * @returns Fully normalized `Notebook` satisfying `NotebookSchema`.
 * @throws {NotebookParseError} When validation fails at either stage.
 * @spec-id europa.contract.notebook-alignment
 */
// deno-lint-ignore require-await
export async function parseNotebook(content: string): Promise<Notebook> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new NotebookParseError(
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
      [],
    );
  }

  // Stage 1: pre-normalize check (accepts string[] source)
  if (!Value.Check(NotebookSchemaPreNormalize, raw)) {
    const errors = [...Value.Errors(NotebookSchemaPreNormalize, raw)].slice(
      0,
      5,
    );
    throw new NotebookParseError("pre-normalize validation failed", errors);
  }

  // Stage 2: normalize
  const normalized = normalize(raw as Record<string, unknown>);

  // Stage 3: post-normalize check
  if (!Value.Check(NotebookSchema, normalized)) {
    const errors = [...Value.Errors(NotebookSchema, normalized)].slice(0, 5);
    throw new NotebookParseError("post-normalize validation failed", errors);
  }

  return normalized as Notebook;
}

function joinText(v: string | string[]): string {
  return Array.isArray(v) ? v.join("") : v;
}

function normalize(raw: Record<string, unknown>): unknown {
  const cells = (raw.cells as unknown[]).map((cell) => {
    const c = { ...(cell as Record<string, unknown>) };

    // Normalize source: string[] → string
    if (Array.isArray(c.source)) c.source = joinText(c.source as string[]);

    // Ensure cell.id exists
    if (!c.id) {
      c.id = crypto.randomUUID();
      // Upgrade nbformat_minor to 5 when we assign an id (FR-003)
      if (typeof raw.nbformat_minor === "number" && raw.nbformat_minor < 5) {
        raw = { ...raw, nbformat_minor: 5 };
      }
    }

    // Normalize stream output text
    if (Array.isArray(c.outputs)) {
      c.outputs = (c.outputs as unknown[]).map((out) => {
        const o = { ...(out as Record<string, unknown>) };
        if (o.output_type === "stream" && Array.isArray(o.text)) {
          o.text = joinText(o.text as string[]);
        }
        return o;
      });
    }

    // Ensure metadata exists
    if (!c.metadata) c.metadata = {};

    return c;
  });

  return { ...raw, cells };
}
