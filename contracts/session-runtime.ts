/**
 * Augmented session type that includes kernel runtime state.
 *
 * `SessionRuntime` is a hand-written augment type (whitelist exception to
 * Constitution I) because the `WebSocket` and `AbortController` types cannot
 * be expressed in TypeBox. See DESIGN.md §4.4.
 *
 * The canonical `SessionRuntime` for storage is defined in
 * `denops/europa/session/state.ts`. This file re-exports for external consumers.
 *
 * @module contracts/session-runtime
 */

import type { Session } from "../schema/session.ts";
import type { KernelRuntime } from "./kernel-client.ts";

/**
 * Runtime session augmented with live kernel connection state.
 *
 * The base `Session` schema tracks serializable state.
 * `SessionRuntime` adds in-process runtime objects that cannot be serialized.
 */
export type SessionRuntime = Session & {
  kernelRuntime?: KernelRuntime;
};
