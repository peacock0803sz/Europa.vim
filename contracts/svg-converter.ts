/**
 * Hand-written contract for the SVG → PNG converter (Phase 3.6).
 *
 * Authorized by the SoT separation policy (DESIGN.ja.md §3.5 / §3.7):
 * - The `SvgConversionResult` discriminated union is defined as a TypeBox
 *   schema in `schema/svg-conversion.ts` (TypeBox SoT).
 * - This interface declares the runtime contract — function signatures and
 *   side-effect boundaries — that cannot be expressed as TypeBox alone.
 *
 * @module contracts/svg-converter
 * @spec-id europa.render.image.svg-rsvg
 * @spec-id europa.render.image.svg-cache
 */

import type { Static } from "@sinclair/typebox";
import type { SvgConversionResultSchema } from "../schema/svg-conversion.ts";

/**
 * Result of a single SVG → PNG conversion attempt.
 *
 * Discriminated by `ok`:
 * - `ok: true` carries the PNG base64 + dimensions + sha256 (cache key).
 * - `ok: false` carries a `reason` enum and optional stderr fragment.
 *
 * Errors raised by `Deno.Command` or `crypto.subtle` are caught inside
 * `convertSvgToPng` and converted to `{ ok: false, reason: ... }` so that
 * callers never have to `try/catch`. This is a hard contract:
 * `convertSvgToPng` MUST NOT throw.
 *
 * @spec-id europa.render.image.svg-rsvg
 */
export type SvgConversionResult = Static<typeof SvgConversionResultSchema>;

/**
 * SVG → PNG conversion entry point.
 *
 * Pipes `svgBytes` to `rsvg-convert --format=png` (stdin), reads PNG bytes
 * from stdout, and returns a base64-encoded payload along with width/height
 * decoded from the PNG IHDR chunk.
 *
 * Caches successful conversions in a module-private LRU (capacity 50) keyed
 * by the SHA-256 of the input bytes. Cache hits skip the subprocess entirely
 * and bump the entry to MRU. Cache misses with `ok: false` are NOT stored,
 * so the next call retries. The `binary-missing` reason short-circuits
 * subsequent calls within the same process (one detection, then session-
 * level `:messages` warning emitted by the caller).
 *
 * The function is synchronous-friendly: it always resolves (never rejects).
 * All failure modes (binary missing, subprocess non-zero exit, stderr decode
 * error, OS-level errors) become `{ ok: false, reason }`.
 *
 * Called from `buildRenderPlan`'s pre-pass through
 * `pooledMap(poolLimit, ...)` where `poolLimit = max(2, min(navigator.hardwareConcurrency, 8))`.
 * The partial-render path reaches the same pre-pass indirectly via
 * `applyPartialRenderPlan` → `buildRenderPlan`; there is no separate
 * partial builder today.
 *
 * @param svgBytes - The raw `image/svg+xml` value from `Output.data` (string).
 * @returns Always-resolving `Promise<SvgConversionResult>`.
 * @spec-id europa.render.image.svg-rsvg
 * @spec-id europa.render.image.svg-cache
 */
export type ConvertSvgToPng = (
  svgBytes: string,
) => Promise<SvgConversionResult>;

/**
 * Register the handler called once on first `binary-missing` detection.
 *
 * Called by `main.ts` `init()` with a denops-RPC closure that emits a
 * `:messages` warning. The handler fires at most once per process (FR-021).
 * Calling `setBinaryMissingHandler` a second time replaces the handler
 * (last-writer-wins; in practice only `main.ts` ever calls it).
 *
 * Separating the warning side-effect from `convertSvgToPng` keeps the
 * converter usable in test contexts without needing a live Denops instance.
 *
 * @spec-id europa.render.image.svg-binary-missing-warning
 */
export type SetBinaryMissingHandler = (handler: () => void) => void;

/**
 * Module-private cache surface (exposed for testing only).
 *
 * Implementations using `@std/cache/lru-cache` wrap the cache in a singleton
 * scoped to the module file. Tests may import `__resetSvgCacheForTest()` to
 * clear the singleton between test cases (process-lifetime semantics make
 * leakage across tests possible).
 *
 * @spec-id europa.render.image.svg-cache
 */
export interface SvgConverterTestHooks {
  /**
   * Clear the LRU cache and the `binary-missing` short-circuit flag.
   *
   * Idempotent. Intended for test setup/teardown only — production code
   * must not call this.
   */
  __resetSvgCacheForTest(): void;
}

/**
 * Side-effect boundary summary (informational, not enforced by type system):
 *
 * - Uses `Deno.Command("rsvg-convert", { args: ["--format=png"], stdin: "piped",
 *   stdout: "piped", stderr: "piped" })`. Requires `--allow-run` permission.
 *   NOTE: `--unlimited` and dimension flags (`-w`, `-h`, `-d`) are NEVER passed.
 * - Maintains a module-private in-flight `Map<sha256, Promise<Result>>` so that
 *   identical SVGs submitted concurrently share one subprocess (SC-003).
 * - Uses `crypto.subtle.digest("SHA-256", ...)`. Standard Web API, no
 *   additional permission needed.
 * - Reads `navigator.hardwareConcurrency` (Web standard) for callers to size
 *   their `pooledMap` pool — this contract does not itself launch concurrent
 *   work; concurrency is the caller's (`buildRenderPlan`) responsibility.
 * - Writes to module-private LRU cache state and in-flight map; no other
 *   process-wide state.
 *
 * Render-layer same as `render/image.ts`:
 * - This contract IS allowed to launch subprocesses (SVG → PNG happens at
 *   `buildRenderPlan` pre-pass, which is async by design).
 * - `render/dispatcher.ts` / `render/image.ts` themselves remain synchronous
 *   pure data transforms (DESIGN.ja.md §3.7.5).
 */
