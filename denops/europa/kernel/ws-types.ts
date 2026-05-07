/**
 * Shared state interface consumed by WebSocket helper modules.
 *
 * `ServerKernelClient` implements this interface so helper functions can read
 * and mutate the fields they need without importing the concrete class
 * (which would create a circular dependency).
 *
 * @module europa-kernel-ws-types
 * @category Kernel
 */

import type { KernelMessage } from "../../../schema/message.ts";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";

/**
 * Subset of `ServerKernelClient` state that WebSocket helper modules need
 * to read or mutate. Implemented by `ServerKernelClient`.
 */
export interface WSConnectionState {
  // ---- read-only config ----
  readonly kernelInfoTimeoutMs: number;
  readonly wsReconnectMaxRetries: number;
  readonly wsReconnectInitialIntervalMs: number;
  readonly wsReconnectMultiplier: number;

  // ---- mutable connection fields ----
  wsSocket: WebSocket | null;
  wsUrl: string | null;
  wsSubprotocols: string[];
  wsSubprotocol: "v1" | "default" | null;
  wsPersistentMessageHandler: ((e: MessageEvent) => void) | null;
  wsMessageHandlers: Set<(msg: KernelMessage) => void>;
  wsRuntime: KernelRuntime | null;
  // Abort controller for the current connection lifecycle, set by start()
  // before kernelInfo() is called and therefore before wsRuntime exists.
  wsAbort: AbortController | null;
}
