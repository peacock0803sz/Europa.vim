/**
 * Minimal type stub for @std/cache/lru-cache used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:@std/cache) and is resolved at
 * runtime by Deno via deno.json `imports`. TypeDoc/tsc cannot reach JSR, so
 * this stub exposes only LruCache, which is the sole export imported
 * from this module in Europa.vim.
 */

export declare class LruCache<K, V> {
  constructor(capacity: number);
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
}
