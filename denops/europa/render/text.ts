/**
 * Text renderers for stream, plain text, and error outputs.
 *
 * All renderers apply `stripAnsi` first before producing lines.
 * Trailing whitespace is preserved (jupyter output fidelity).
 *
 * @category Render
 * @module text
 */

import type { Highlight, RenderFragment } from "../../../schema/render-plan.ts";
import { stripAnsi } from "./ansi.ts";

function makeFragment(
  lines: string[],
  highlights: Highlight[],
): RenderFragment {
  return {
    lines,
    highlights,
    virtText: [],
    imagePlacements: [],
    clickables: [],
  };
}

/**
 * Render plain text as a `RenderFragment`.
 *
 * Strips ANSI codes and splits on newlines. Trailing whitespace is preserved.
 *
 * @param text - Raw text to render.
 * @returns `RenderFragment` with plain lines and no highlights.
 * @spec-id europa.render.text.plain
 */
export function renderText(text: string): RenderFragment {
  const stripped = stripAnsi(text);
  const lines = stripped.split("\n");
  return makeFragment(lines, []);
}

/**
 * Render a stream output (stdout or stderr).
 *
 * stdout receives `EuropaStream` highlight; stderr receives `EuropaStreamErr`.
 *
 * @param name - Stream name: `"stdout"` or `"stderr"`.
 * @param text - Raw stream text (may contain ANSI codes).
 * @returns `RenderFragment` with appropriate stream highlight applied to all lines.
 * @spec-id europa.render.text.stream
 */
export function renderStream(
  name: "stdout" | "stderr",
  text: string,
): RenderFragment {
  const stripped = stripAnsi(text);
  const lines = stripped.split("\n");
  const hlGroup = name === "stderr" ? "EuropaStreamErr" : "EuropaStream";

  const highlights: Highlight[] = lines.map((_, i) => ({
    hlGroup,
    line: i,
    col: 0,
    endCol: -1,
  }));

  return makeFragment(lines, highlights);
}

/**
 * Render an error output with ename/evalue header and traceback.
 *
 * The first line is `ename: evalue`. Each traceback entry gets `EuropaError`
 * highlight. All content passes through `stripAnsi`.
 *
 * @param ename - Exception class name.
 * @param evalue - Exception message.
 * @param traceback - Array of traceback strings (may contain ANSI codes).
 * @returns `RenderFragment` with error highlights applied.
 * @spec-id europa.render.text.error
 */
export function renderError(
  ename: string,
  evalue: string,
  traceback: readonly string[],
): RenderFragment {
  const header = `${ename}: ${evalue}`;
  const strippedTraceback = traceback.map((l) => stripAnsi(l));
  const lines = [header, ...strippedTraceback];

  const highlights: Highlight[] = strippedTraceback.map((_, i) => ({
    hlGroup: "EuropaError",
    line: i + 1,
    col: 0,
    endCol: -1,
  }));

  return makeFragment(lines, highlights);
}
