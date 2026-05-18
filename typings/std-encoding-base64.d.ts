/**
 * Minimal type stub for \@std/encoding/base64 used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:\@std/encoding) and is resolved at
 * runtime by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so
 * this stub exposes the functions imported from this module in Europa.vim.
 */

export declare function decodeBase64(b64: string): Uint8Array;
export declare function encodeBase64(data: Uint8Array | ArrayBuffer): string;
