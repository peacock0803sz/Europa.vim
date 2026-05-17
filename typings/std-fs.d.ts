/**
 * Minimal type stub for @std/fs used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:@std/fs) and is resolved at
 * runtime by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so
 * this stub exposes only ensureDir, which is the sole function imported
 * from this module in Europa.vim.
 */

export declare function ensureDir(dir: string | URL): Promise<void>;
