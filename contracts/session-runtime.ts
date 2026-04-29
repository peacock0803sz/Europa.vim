/**
 * Augmented session type that includes kernel runtime state.
 *
 * `SessionRuntime` is a hand-written augment type (whitelist exception to
 * Constitution I) because the `WebSocket` and opaque ZMQ client types cannot
 * be expressed in TypeBox. See DESIGN.md §4.4.
 *
 * In Phase 2, `kernelRuntime` is always `undefined`.
 *
 * @module contracts/session-runtime
 */

import type { KernelInfo, Session } from "../schema/session.ts";

/**
 * Runtime session augmented with live kernel connection state.
 *
 * The base `Session` schema tracks what is persisted to disk-level state.
 * `SessionRuntime` adds in-process runtime objects that cannot be serialized.
 */
export type SessionRuntime = Session & {
  kernelRuntime?: {
    info: KernelInfo;
    socket?: WebSocket;
    // Phase 4: zmq?: ZmqClient — added when zeromq lands
    zmq?: unknown;
  };
};
