/**
 * Minimal type stub for @std/encoding/hex used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:@std/encoding) and is resolved at
 * runtime by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so
 * this stub exposes only `encodeHex`, which is the sole function imported
 * from this module in Europa.vim.
 */

export declare function encodeHex(data: Uint8Array | ArrayBuffer): string;
