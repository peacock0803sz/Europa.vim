/**
 * Minimal type stub for \@lambdalisue/ansi-escape-code used by TypeDoc.
 *
 * The real package lives on JSR (jsr:\@lambdalisue/ansi-escape-code) and is
 * resolved at runtime by Deno. TypeDoc/tsc cannot reach JSR, so this stub
 * exposes only the function Europa.vim calls.
 *
 * Real signature returns `[stripped, ...sequences]`; consumers here only read
 * the first element, so the tail is typed as `unknown[]`.
 */

export declare function trimAndParse(text: string): [string, ...unknown[]];
