/**
 * Central timeout and wall-clock budget constants for the conformance suite.
 *
 * Every budget in the SCALED section is multiplied by {@link TIMEOUT_SCALE} at
 * module load, so call sites use the exported constants verbatim and must never
 * call {@link scaleMs} on them again. Constants in the EXACT section carry the
 * `EXACT_` prefix and are deliberately left unscaled: they encode a semantic
 * ("fire immediately", "sampling resolution"), not a budget, so scaling them
 * would change what a test asserts rather than how much slack it has.
 *
 * Every base value except the port-retry gate is the largest value its call
 * site used before this module existed, which keeps the invariant "no budget
 * gets stricter than it was" at the default scale of 1 while a single
 * environment variable buys headroom on loaded CI runners. That gate is
 * deliberately new: the retry window used to be whatever was left of one shared
 * spawn deadline, and a fixed 10 s narrows it so a jupyter that dies late fails
 * fast instead of being retried.
 *
 * @module tests/conformance/timeouts
 */

import { assert } from "@std/assert";

const SCALE_ENV = "EUROPA_CONFORMANCE_TIMEOUT_SCALE";

/**
 * Parse the scale factor, rejecting anything that is not a sane multiplier.
 *
 * Falling back to a default on a malformed value would be worse than failing:
 * a typo in CI would silently relax (or with 0, disable) every budget in the
 * suite, and the flake this scaling exists to absorb would come back invisible.
 */
function parseScale(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    throw new Error(
      `${SCALE_ENV} must be a finite number in (0, 100]; got ${
        JSON.stringify(raw)
      }`,
    );
  }
  return n;
}

/** Multiplier applied to every scaled budget below. Defaults to 1. */
export const TIMEOUT_SCALE: number = parseScale(Deno.env.get(SCALE_ENV));

/** Multiply an environment-sensitive budget. Returns whole milliseconds. */
export function scaleMs(ms: number): number {
  return Math.ceil(ms * TIMEOUT_SCALE);
}

// --- Scaled budgets ---------------------------------------------------------

/** Deadline for one `jupyter server` boot attempt to answer `/api`. */
export const SERVER_READY_TIMEOUT_MS = scaleMs(30_000);

/**
 * Budget for the kernel_info_request/reply handshake, capped at the 60 s
 * maximum `schema/config.ts` allows.
 *
 * The cap matters more than the scaling. 30 s, 60 s and 240 s have all failed
 * the known handshake flake in the same way, so buying more time past the
 * schema maximum has never rescued a run; meanwhile at the CI scale of 4 two
 * stuck handshakes at 240 s each exhaust the 10-minute step cap, and a killed
 * step prints no stderr dump at all — the diagnostics go first.
 */
export const KERNEL_INFO_TIMEOUT_MS = Math.min(scaleMs(60_000), 60_000);

/** SC-002: `ServerKernelClient.start()` round trip. */
export const KERNEL_START_BUDGET_MS = scaleMs(5_000);

/** SC-004: `ServerKernelClient.shutdown()` round trip. */
export const KERNEL_SHUTDOWN_BUDGET_MS = scaleMs(5_000);

/** SC-001: a single trivial `execute_request` round trip. */
export const EXECUTE_BUDGET_MS = scaleMs(5_000);

/** SC-002: running a 100-cell notebook end to end. */
export const RUN_ALL_100_BUDGET_MS = scaleMs(30_000);

/** SC-003: interrupt request to the kernel reporting idle again. */
export const INTERRUPT_BUDGET_MS = scaleMs(2_000);

/** SC-004: restart request to a usable kernel again. */
export const RESTART_BUDGET_MS = scaleMs(10_000);

/** SC-010a: an abort must unwind the in-flight operation this quickly. */
export const ABORT_PROPAGATION_BUDGET_MS = scaleMs(100);

/** Upper bound on the poll loop that waits for a reconnect to be observable. */
export const ABORT_POLL_LIMIT_MS = scaleMs(1_000);

/** SC-010a: `start()` followed immediately by `abort()` settles this quickly. */
export const START_ABORT_BUDGET_MS = scaleMs(5_000);

/**
 * SC-001: gap between consecutive IOPub stream messages. The kernel emits them
 * 500 ms apart, so this is 4x slack before we call the kernel frozen.
 */
export const STREAM_GAP_BUDGET_MS = scaleMs(2_000);

/** `wsReconnectInitialIntervalMs` used by the abort-race specs. */
export const RECONNECT_BACKOFF_INITIAL_MS = scaleMs(2_000);

/** Warm-up wait that lets a reconnect attempt get under way before aborting. */
export const RECONNECT_SETTLE_DELAY_MS = scaleMs(300);

/** Deadline for the watchdog spec's own jupyter startup scan. */
export const WATCHDOG_STARTUP_TIMEOUT_MS = scaleMs(30_000);

/** How long the watchdog gets to reap an orphaned server after its parent dies. */
export const WATCHDOG_KILL_BUDGET_MS = scaleMs(15_000);

// --- Exact (unscaled) values ------------------------------------------------

/**
 * "Time out before the reply can possibly arrive." Scaling this would turn the
 * abort-race test into a plain success-path test.
 */
export const EXACT_KERNEL_INFO_IMMEDIATE_MS = 1;

/**
 * How early a jupyter exit still counts as a lost port race, and so as worth
 * respawning on a fresh port. A collision kills the process within a second or
 * two; the rest is margin for a slow runner.
 *
 * Unscaled because this classifies a failure rather than bounding one. At the
 * CI scale of 4 the window would reach 40 s, and a jupyter that spent 35 s
 * dying of, say, a broken Python environment would be read as a port collision
 * and respawned twice more into the same failure.
 */
export const EXACT_PORT_RETRY_EARLY_EXIT_MS = 10_000;

/** Sampling resolution of the abort poll loop, not a budget. */
export const EXACT_ABORT_POLL_INTERVAL_MS = 5;

/**
 * Delay before cancelling a queued cell. It is positioned relative to a
 * `time.sleep(0.5)` running inside the kernel, and that Python literal cannot
 * be scaled, so this one must stay fixed too.
 */
export const EXACT_CANCEL_TRIGGER_DELAY_MS = 50;

// --- Assertion helper -------------------------------------------------------

/**
 * Assert an elapsed time is within budget, naming the scale in the failure so
 * a CI log makes it obvious the budget was already relaxed.
 */
export function assertWithinBudget(
  label: string,
  elapsedMs: number,
  budgetMs: number,
): void {
  const suffix = TIMEOUT_SCALE === 1 ? "" : ` (${SCALE_ENV}=${TIMEOUT_SCALE})`;
  assert(
    elapsedMs < budgetMs,
    `${label} took ${elapsedMs}ms, expected < ${budgetMs}ms${suffix}`,
  );
}
