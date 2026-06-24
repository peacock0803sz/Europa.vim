/**
 * Minimal type stub for node:crypto used by TypeDoc generation.
 *
 * Deno resolves node: built-ins at runtime (and so do `deno check` / `deno
 * test`), but TypeDoc/tsc cannot, so this stub exposes only `createHmac` and
 * `timingSafeEqual` — the sole functions imported from node:crypto in
 * Europa.vim (ZMQ HMAC signing in wire/protocol-zmq.ts).
 */

export interface Hmac {
  update(data: Uint8Array): Hmac;
  digest(encoding: "hex"): string;
}

export declare function createHmac(algorithm: string, key: string): Hmac;

export declare function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
