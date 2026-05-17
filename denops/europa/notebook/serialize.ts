/**
 * Notebook serializer: Notebook → canonicalized JSON string.
 *
 * @category Notebook
 */
import type { Notebook } from "../../../schema/notebook.ts";

/**
 * Serialize a {@link Notebook} to a canonical JSON string.
 *
 * Uses 1-space indent, LF line endings, and a single trailing newline.
 * MIME bundle key order is preserved (JavaScript object insertion order).
 *
 * @param nb - A {@link Notebook} satisfying `NotebookSchema`.
 * @returns Canonical JSON string suitable for writing to a `.ipynb` file.
 * @throws Never — pure function with no I/O.
 * @example
 * ```ts
 * const nb = await parseNotebook(await Deno.readTextFile("hello.ipynb"));
 * await Deno.writeTextFile("hello.ipynb", serializeNotebook(nb));
 * ```
 * MUST be called with the original `Notebook` entity, not a shadow-injected
 * variant. Shadow inject (Phase 3.6 SVG→PNG) lives in build-local state only
 * and is never written back into the `Notebook` argument — this keeps the
 * serialized `.ipynb` bit-identical to the kernel-emitted original (FR-027).
 * @spec-id europa.notebook.serialize.format
 * @spec-id europa.notebook.serialize.round-trip
 * @spec-id europa.render.image.svg-serialize-pristine
 * @category Notebook
 */
export function serializeNotebook(nb: Notebook): string {
  const s = JSON.stringify(nb, null, 1);
  return s.endsWith("\n") ? s : s + "\n";
}
