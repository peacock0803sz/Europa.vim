/**
 * Markdown renderer with heading highlights and inline overlay decorations.
 *
 * @category Render
 * @module markdown
 */

import {
  emptyRenderFragment,
  type MdDecoration,
  type RenderFragment,
} from "../../../schema/render-plan.ts";
import { Lexer } from "marked";

const ATX_HEADING_RE = /^#{1,6} /;
const SETEXT_UNDERLINE_RE = /^(=+|-+)$/;
const AUTOLINK_RE = /^<[^>\n]+>$/;
const FENCE_RE = /^(```+|~~~+)/;
let parseExceptionLogged = false;

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getTokenArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is Record<string, unknown> =>
    typeof item === "object" && item !== null
  );
}

function buildLineStarts(source: string): number[] {
  const lineStarts = [0];

  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }

  return lineStarts;
}

function offsetToLineCol(lineStarts: number[], offset: number) {
  let line = 0;

  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i] > offset) break;
    line = i;
  }

  return {
    line,
    col: offset - lineStarts[line],
  };
}

function* locateTokens(
  source: string,
  tokens: Array<Record<string, unknown>>,
  offset: number,
  lineStarts = buildLineStarts(source),
): Generator<{
  token: Record<string, unknown>;
  line: number;
  colStart: number;
  colEnd: number;
}> {
  let searchOffset = offset;

  for (const token of tokens) {
    const raw = getString(token.raw) ?? "";
    if (raw.length === 0) continue;

    const absoluteOffset = source.indexOf(raw, searchOffset);
    if (absoluteOffset < 0) continue;

    const start = offsetToLineCol(lineStarts, absoluteOffset);
    const end = offsetToLineCol(lineStarts, absoluteOffset + raw.length);
    yield {
      token,
      line: start.line,
      colStart: start.col,
      colEnd: end.col,
    };

    const childCollections: Array<Array<Record<string, unknown>>> = [];
    if (getString(token.type) !== "code") {
      const inlineTokens = getTokenArray(token.tokens);
      if (inlineTokens.length > 0) childCollections.push(inlineTokens);
    }
    const items = getTokenArray(token.items);
    if (items.length > 0) childCollections.push(items);

    for (const children of childCollections) {
      yield* locateTokens(source, children, absoluteOffset, lineStarts);
    }

    searchOffset = absoluteOffset + raw.length;
  }
}

function pushHighlight(fragment: RenderFragment, line: number): void {
  fragment.highlights.push({
    hlGroup: "EuropaCellMarkdown",
    line,
    col: 0,
    endCol: -1,
  });
}

function applyHeadingHighlightsFromSource(
  fragment: RenderFragment,
  source: string,
): void {
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (ATX_HEADING_RE.test(lines[i])) {
      pushHighlight(fragment, i);
      continue;
    }

    if (
      i + 1 < lines.length &&
      lines[i].trim().length > 0 &&
      SETEXT_UNDERLINE_RE.test(lines[i + 1])
    ) {
      pushHighlight(fragment, i);
      pushHighlight(fragment, i + 1);
      i++;
    }
  }
}

/**
 * Preserve Phase 2 heading-only highlights while extending markdown rendering.
 *
 * @spec-id europa.render.markdown.heading-only
 */
function applyHeadingHighlights(
  fragment: RenderFragment,
  source: string,
  tokens: Array<Record<string, unknown>>,
): void {
  if (tokens.length === 0) {
    applyHeadingHighlightsFromSource(fragment, source);
    return;
  }

  for (const located of locateTokens(source, tokens, 0)) {
    if (getString(located.token.type) !== "heading") continue;

    pushHighlight(fragment, located.line);
    const rawLines = (getString(located.token.raw) ?? "").split("\n");
    if (rawLines.length >= 2 && SETEXT_UNDERLINE_RE.test(rawLines[1])) {
      pushHighlight(fragment, located.line + 1);
    }
  }
}

function pushDecoration(
  decorations: MdDecoration[],
  decoration: MdDecoration,
): void {
  decorations.push(decoration);
}

function pushWrappedDecoration(
  decorations: MdDecoration[],
  line: number,
  colStart: number,
  colEnd: number,
  markerWidth: number,
  hlGroup: MdDecoration["hlGroup"],
): void {
  pushDecoration(decorations, {
    line,
    colStart,
    colEnd: colStart + markerWidth,
    conceal: "",
  });
  pushDecoration(decorations, {
    line,
    colStart: colStart + markerWidth,
    colEnd: colEnd - markerWidth,
    hlGroup,
  });
  pushDecoration(decorations, {
    line,
    colStart: colEnd - markerWidth,
    colEnd,
    conceal: "",
  });
}

/**
 * Build inline markdown decorations for overlay rendering.
 *
 * @spec-id europa.render.markdown.inline-decoration
 */
function buildMdDecorations(
  tokens: Array<Record<string, unknown>>,
  source: string,
): MdDecoration[] {
  const decorations: MdDecoration[] = [];
  const quoteByLine = new Map<number, MdDecoration>();

  for (
    const { token, line, colStart, colEnd } of locateTokens(source, tokens, 0)
  ) {
    const raw = getString(token.raw) ?? "";

    switch (getString(token.type)) {
      case "strong":
        pushWrappedDecoration(
          decorations,
          line,
          colStart,
          colEnd,
          2,
          "EuropaMdBold",
        );
        break;
      case "em":
        pushWrappedDecoration(
          decorations,
          line,
          colStart,
          colEnd,
          1,
          "EuropaMdItalic",
        );
        break;
      case "codespan": {
        const markerWidth = raw.match(/^`+/)?.[0].length ?? 1;
        pushWrappedDecoration(
          decorations,
          line,
          colStart,
          colEnd,
          markerWidth,
          "EuropaMdCode",
        );
        break;
      }
      case "link":
        if (
          raw.startsWith("<") &&
          raw.endsWith(">") &&
          getString(token.href) === getString(token.text)
        ) {
          pushDecoration(decorations, {
            line,
            colStart,
            colEnd: colStart + 1,
            conceal: "",
          });
          pushDecoration(decorations, {
            line,
            colStart: colStart + 1,
            colEnd: colEnd - 1,
            hlGroup: "EuropaMdLink",
          });
          pushDecoration(decorations, {
            line,
            colStart: colEnd - 1,
            colEnd,
            conceal: "",
          });
          break;
        }

        if (raw.startsWith("[")) {
          const suffixStart = raw.lastIndexOf("](");
          if (suffixStart > 0) {
            pushDecoration(decorations, {
              line,
              colStart,
              colEnd: colStart + 1,
              conceal: "",
            });
            pushDecoration(decorations, {
              line,
              colStart: colStart + 1,
              colEnd: colStart + suffixStart,
              hlGroup: "EuropaMdLink",
            });
            pushDecoration(decorations, {
              line,
              colStart: colStart + suffixStart,
              colEnd,
              conceal: "",
            });
          }
        }
        break;
      case "image":
        if (raw.startsWith("![")) {
          const suffixStart = raw.lastIndexOf("](");
          if (suffixStart > 1) {
            pushDecoration(decorations, {
              line,
              colStart,
              colEnd: colStart + 2,
              conceal: "",
            });
            pushDecoration(decorations, {
              line,
              colStart: colStart + 2,
              colEnd: colStart + suffixStart,
              hlGroup: "EuropaMdLink",
            });
            pushDecoration(decorations, {
              line,
              colStart: colStart + suffixStart,
              colEnd,
              conceal: "",
            });
          }
        }
        break;
      case "del":
        pushWrappedDecoration(
          decorations,
          line,
          colStart,
          colEnd,
          2,
          "EuropaMdStrike",
        );
        break;
      case "list_item": {
        // item.raw may carry a trailing newline; accumulating split lengths
        // (the previous approach) would overshoot onto the following blank line.
        const marker = raw.match(/^(\d+[.)]|[-*+])/);
        if (marker) {
          pushDecoration(decorations, {
            line,
            colStart,
            colEnd: colStart + marker[1].length,
            hlGroup: "EuropaMdListMarker",
          });
        }
        break;
      }
      case "blockquote": {
        const lines = raw.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^(?:>\s*)+/);
          if (!match) continue;

          const quoteWidth = [...match[0]].filter((char) =>
            char === ">"
          ).length;
          const lineNumber = line + i;
          const current = quoteByLine.get(lineNumber);
          if (current && current.colEnd >= quoteWidth) continue;
          quoteByLine.set(lineNumber, {
            line: lineNumber,
            colStart: 0,
            colEnd: quoteWidth,
            hlGroup: "EuropaMdQuote",
            hlEol: true,
          });
        }
        break;
      }
      case "hr": {
        const ruleText = raw.trimEnd();
        pushDecoration(decorations, {
          line,
          colStart,
          colEnd: colStart + ruleText.length,
          hlGroup: "EuropaMdRule",
          hlEol: true,
        });
        break;
      }
      case "code": {
        const rawLines = raw.split("\n");
        const openingLine = rawLines[0] ?? "";
        const openingFence = openingLine.match(FENCE_RE)?.[1] ?? "```";
        const lang = getString(token.lang);
        pushDecoration(decorations, {
          line,
          colStart,
          colEnd: colStart + openingFence.length,
          conceal: "",
          ...(lang
            ? {
              virtText: lang,
              virtTextHlGroup: "EuropaMdFenceLang",
            }
            : {}),
        });

        const closingLineIndex = raw.endsWith("\n")
          ? line + rawLines.length - 2
          : line + rawLines.length - 1;
        pushDecoration(decorations, {
          line: closingLineIndex,
          colStart: 0,
          colEnd: openingFence.length,
          conceal: "",
        });
        break;
      }
      case "text":
        if (AUTOLINK_RE.test(raw)) {
          pushDecoration(decorations, {
            line,
            colStart,
            colEnd: colStart + 1,
            conceal: "",
          });
          pushDecoration(decorations, {
            line,
            colStart: colStart + 1,
            colEnd: colEnd - 1,
            hlGroup: "EuropaMdLink",
          });
          pushDecoration(decorations, {
            line,
            colStart: colEnd - 1,
            colEnd,
            conceal: "",
          });
        }
        break;
      default:
        break;
    }
  }

  return [...decorations, ...quoteByLine.values()];
}

/**
 * Render a markdown source string with heading highlights and inline
 * decorations.
 *
 * @param source - Raw markdown source (may include newlines).
 * @returns `RenderFragment` with markdown highlights and decorations applied.
 */
export function renderMarkdown(source: string): RenderFragment {
  const fragment: RenderFragment = {
    ...emptyRenderFragment(),
    lines: source.split("\n"),
  };

  try {
    const tokens = Lexer.lex(source) as Array<Record<string, unknown>>;
    applyHeadingHighlights(fragment, source, tokens);
    fragment.mdDecorations = buildMdDecorations(tokens, source);
    return fragment;
  } catch (error) {
    if (!parseExceptionLogged) {
      parseExceptionLogged = true;
      console.debug(
        "[europa] markdown parse failed; falling back to heading-only",
        error,
      );
    }
    applyHeadingHighlightsFromSource(fragment, source);
    return fragment;
  }
}
