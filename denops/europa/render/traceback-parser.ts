/**
 * IPython 8.x traceback frame parser.
 *
 * Pure synchronous data transform: takes ANSI-stripped traceback lines and
 * yields the list of frames the viewer can turn into clickables / highlights.
 * No I/O, no host RPC — Render layer §3.7.5 invariant.
 *
 * Two regexes are tried in priority order per line:
 *   1. Cell frame   `/Cell In\[(\d+)\], line (\d+)/`
 *   2. File frame   `/File "?((?:[A-Za-z]:)?[^":\n]+?)"?:(\d+)(?:, in .+)?$/m`
 *      (the optional `[A-Za-z]:` keeps a Windows drive letter in the path).
 *
 * Only the **first match per line** is recorded (Session Q-multiple-frames-
 * per-line). The legacy IPython 7.x `<ipython-input-N-...>` shape is
 * intentionally NOT matched (SC-017).
 *
 * @module europa-render-traceback-parser
 * @category Render
 */

type TracebackFrame =
  | {
    kind: "cell";
    line: number;
    colStart: number;
    colEnd: number;
    executionCount: number;
    sourceLine: number;
  }
  | {
    kind: "file";
    line: number;
    colStart: number;
    colEnd: number;
    path: string;
    sourceLine: number;
  };

const CELL_FRAME_RE = /Cell In\[(\d+)\], line (\d+)/;
// IPython emits Windows frames like `File C:\proj\x.py:10`, where the drive
// colon must not be mistaken for the trailing `:<line>` separator. The
// optional `[A-Za-z]:` prefix sits ahead of the colon-free path body so that
// such frames parse; without it the regex cannot match them at all.
const FILE_FRAME_RE = /File "?((?:[A-Za-z]:)?[^":\n]+?)"?:(\d+)(?:, in .+)?$/m;

/**
 * Parse an array of ANSI-stripped traceback lines into a list of frames.
 *
 * @param strippedLines - Lines from `renderError` after `stripAnsi`.
 * @returns A list of frames in document order. Empty if no frames matched.
 * @spec-id europa.render.traceback.parse.ipython8
 */
export function parseTraceback(
  strippedLines: readonly string[],
): readonly TracebackFrame[] {
  const frames: TracebackFrame[] = [];
  for (let i = 0; i < strippedLines.length; i++) {
    const line = strippedLines[i];
    const cellMatch = CELL_FRAME_RE.exec(line);
    if (cellMatch) {
      const start = cellMatch.index;
      frames.push({
        kind: "cell",
        line: i,
        colStart: start,
        colEnd: start + cellMatch[0].length,
        executionCount: parseInt(cellMatch[1], 10),
        sourceLine: parseInt(cellMatch[2], 10),
      });
      continue;
    }
    const fileMatch = FILE_FRAME_RE.exec(line);
    if (fileMatch) {
      const start = fileMatch.index;
      frames.push({
        kind: "file",
        line: i,
        colStart: start,
        colEnd: start + fileMatch[0].length,
        path: fileMatch[1],
        sourceLine: parseInt(fileMatch[2], 10),
      });
    }
  }
  return frames;
}
