/**
 * Minimal type stub for \@denops/std/batch used by TypeDoc generation.
 *
 * The real package lives on JSR and is resolved at runtime by Deno.
 * TypeDoc uses Node.js module resolution so this stub provides the
 * `batch` function signature without the full implementation.
 */

import type { Denops } from "./denops-std.d.ts";

/**
 * Batch multiple RPC calls into a single round-trip.
 *
 * All calls made through `helper` inside `fn` are collected and sent
 * atomically via `denops.batch()`. Use for side-effect-only operations;
 * use `collect()` instead when return values are needed.
 */
export declare function batch(
  denops: Denops,
  fn: (helper: Denops) => Promise<void>,
): Promise<void>;
