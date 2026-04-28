/**
 * Phase 0 `.ipynb` smoke pipeline.
 *
 * Read a nbformat 4 notebook, run a minimal Notebook → RenderPlan → string
 * pass, and print the result to stdout. Validates the core technical
 * assumption underlying Phase 2 viewer work without requiring Vim, network,
 * or a Jupyter kernel.
 *
 * `nbformat == 4` is the only accepted major version (any nbformat_minor is
 * accepted). Other major versions exit non-zero with a diagnostic naming the
 * detected value.
 *
 * @module scripts/smoke-ipynb
 *
 * @example
 * ```sh
 * deno run --allow-read scripts/smoke-ipynb.ts tests/fixtures/hello.ipynb
 * ```
 */

const SUPPORTED_NBFORMAT = 4;

/**
 * Coerce a nbformat `source` field (which may be a string or array of strings)
 * to a single string. Per nbformat 4 spec, arrays are concatenated as-is.
 */
function joinSource(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.join("");
  return String(source ?? "");
}

/**
 * Render a single nbformat 4 cell into a textual block including a delimiter,
 * the cell's source, and any stream / execute_result text outputs.
 */
function renderCell(cell: Record<string, unknown>, index: number): string {
  const cellType = String(cell.cell_type ?? "unknown");
  const lines: string[] = [`--- cell ${index + 1} (${cellType}) ---`];
  lines.push(joinSource(cell.source));
  const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
  for (const output of outputs) {
    const o = output as Record<string, unknown>;
    const kind = String(o.output_type ?? "");
    if (kind === "stream") {
      lines.push(
        `[stream:${String(o.name ?? "stdout")}] ${joinSource(o.text)}`,
      );
    } else if (kind === "execute_result" || kind === "display_data") {
      const data = (o.data ?? {}) as Record<string, unknown>;
      const text = data["text/plain"];
      if (text !== undefined) lines.push(`[${kind}] ${joinSource(text)}`);
    } else if (kind === "error") {
      lines.push(
        `[error] ${String(o.ename ?? "Error")}: ${String(o.evalue ?? "")}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Read the notebook at `path`, validate its nbformat, and return the rendered
 * string. Throws if the file is not nbformat == 4.
 *
 * @param path Filesystem path to a nbformat 4 `.ipynb` file.
 * @returns Rendered text suitable for stdout.
 * @throws Error when `nbformat != 4` (after rejecting, the caller exits 1).
 */
export async function smoke(path: string): Promise<string> {
  const raw = await Deno.readTextFile(path);
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Notebook is not a valid JSON object");
  }
  const nbformat = data.nbformat;
  if (nbformat !== SUPPORTED_NBFORMAT) {
    throw new Error(
      `Unsupported nbformat: ${nbformat} (expected ${SUPPORTED_NBFORMAT})`,
    );
  }
  const cells = Array.isArray(data.cells) ? data.cells : [];
  return cells
    .map((cell, i) => renderCell(cell as Record<string, unknown>, i))
    .join("\n\n");
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: smoke-ipynb.ts <notebook.ipynb>");
    Deno.exit(2);
  }
  try {
    const rendered = await smoke(path);
    console.log(rendered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
