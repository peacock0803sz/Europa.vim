/**
 * Minimal type stub for \@std/uuid v7 used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:\@std/uuid) and is resolved at runtime
 * by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so this stub
 * exposes just the v7 helpers that Europa.vim actually calls.
 */

export declare const v7: {
  generate(): string;
  validate(id: string): boolean;
};
