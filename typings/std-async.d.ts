/**
 * Minimal type stub for @std/async used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:@std/async) and is resolved at
 * runtime by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so
 * this stub exposes only pooledMap, which is the sole function imported
 * from this module in Europa.vim.
 */

export declare function pooledMap<T, R>(
  poolLimit: number,
  array: Iterable<T> | AsyncIterable<T>,
  iteratorFn: (item: T) => Promise<R>,
): AsyncIterableIterator<R>;
