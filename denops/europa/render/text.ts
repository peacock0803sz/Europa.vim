/**
 * Text renderers for stream, plain text, and error outputs.
 *
 * All renderers apply `stripAnsi` first before producing lines.
 * Trailing whitespace is preserved (jupyter output fidelity).
 *
 * @category Render
 * @module text
 */

import type {
  Clickable,
  Highlight,
  RenderFragment,
} from "../../../schema/render-plan.ts";
import { stripAnsi } from "./ansi.ts";
import { parseTraceback } from "./traceback-parser.ts";

function makeFragment(
  lines: string[],
  highlights: Highlight[],
  clickables: Clickable[] = [],
): RenderFragment {
  return {
    lines,
    highlights,
    virtText: [],
    imagePlacements: [],
    clickables,
    mdDecorations: [],
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
 * line-highlight. Frames recognised by the IPython 8.x parser additionally
 * receive a `EuropaErrorJump` col-range highlight and a `Clickable` carrying
 * either a `jump_to_cell_line` or `jump_to_file` action. Clickable / highlight
 * line indices are fragment-relative (= header is line 0). All content passes
 * through `stripAnsi`.
 *
 * @param ename - Exception class name.
 * @param evalue - Exception message.
 * @param traceback - Array of traceback strings (may contain ANSI codes).
 * @returns `RenderFragment` with error highlights and clickables applied.
 * @spec-id europa.render.text.error
 */
export function renderError(
  ename: string,
  evalue: string,
  traceback: readonly string[],
): RenderFragment {
  const header = stripAnsi(`${ename}: ${evalue}`);
  // Jupyter traceback entries can contain embedded `\n` (e.g. IPython's
  // "Cell In[N], line K\n----> K ..." frame). flatten on newline so each
  // resulting buffer line is a real single line — otherwise highlight
  // indices drift relative to what setbufline actually writes.
  const tracebackLines = traceback.flatMap((l) => stripAnsi(l).split("\n"));
  const lines = [header, ...tracebackLines];

  const highlights: Highlight[] = tracebackLines.map((_, i) => ({
    hlGroup: "EuropaError",
    line: i + 1,
    col: 0,
    endCol: -1,
  }));

  const frames = parseTraceback(tracebackLines);
  const clickables: Clickable[] = [];
  for (const frame of frames) {
    // +1 because the header line occupies fragment line 0.
    const fragmentLine = frame.line + 1;
    highlights.push({
      hlGroup: "EuropaErrorJump",
      line: fragmentLine,
      col: frame.colStart,
      endCol: frame.colEnd,
      hlEol: false,
    });
    if (frame.kind === "cell") {
      clickables.push({
        line: fragmentLine,
        colStart: frame.colStart,
        colEnd: frame.colEnd,
        action: {
          type: "jump_to_cell_line",
          payload: {
            executionCount: frame.executionCount,
            line: frame.sourceLine,
          },
        },
      });
    } else {
      clickables.push({
        line: fragmentLine,
        colStart: frame.colStart,
        colEnd: frame.colEnd,
        action: {
          type: "jump_to_file",
          payload: {
            path: frame.path,
            line: frame.sourceLine,
          },
        },
      });
    }
  }

  return makeFragment(lines, highlights, clickables);
}
