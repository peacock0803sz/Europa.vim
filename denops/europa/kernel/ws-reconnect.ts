/**
 * WebSocket reconnect loop helpers.
 *
 * `attachReconnectLoop` registers a one-shot "close" listener on a socket
 * that fires the exponential-backoff `runReconnectLoop` when the close was
 * not a clean shutdown (code !== 1000).
 *
 * Extracted from ServerKernelClient to keep the class under 400 lines.
 * No imports from server-client.ts (no circular dependency).
 *
 * @module europa-kernel-ws-reconnect
 * @category Kernel
 */

import { delay } from "@std/async/delay";
import type { WSConnectionState } from "./ws-types.ts";
import {
  attachMessageListener,
  detachMessageListener,
} from "./message-dispatch.ts";
import { connectWS } from "./ws-handshake.ts";

/**
 * Attach a one-shot "close" listener to `socket` that triggers the
 * reconnection loop on unexpected disconnect.
 *
 * `onSocketSwap` is called after each successful reconnect with the new
 * socket so the caller can perform any additional bookkeeping (e.g. updating
 * internal references that are not part of `WSConnectionState`). After
 * `onSocketSwap`, a new reconnect loop is re-attached to the new socket
 * automatically so no recursive plumbing is needed at the call site.
 *
 * @param state       Shared client state (implements WSConnectionState).
 * @param socket      The WebSocket to watch.
 * @param onSocketSwap  Optional callback invoked after the socket is replaced.
 */
export function attachReconnectLoop(
  state: WSConnectionState,
  socket: WebSocket,
  onSocketSwap?: (s: WebSocket) => void,
): void {
  socket.addEventListener("close", async (ev) => {
    if (ev.code === 1000 || !state.wsRuntime) return;
    const runtime = state.wsRuntime;
    // Q-ws-close: flush any pending iopub output so partial results are
    // visible before the abort or reconnect loop fires. Errors are silent
    // because a failed flush must not suppress the reconnect path.
    try {
      await runtime.iopubBatchScheduler?.flushNow();
    } catch { /* silent — flush failure must not block reconnect */ }
    // Abort listener already set state to "disconnected"; skip the loop to
    // avoid a transient "reconnecting" flicker after teardown.
    if (runtime.abort.signal.aborted) return;
    void runReconnectLoop(state, onSocketSwap).catch(() => {});
  }, { once: true });
}

/**
 * Exponential-backoff reconnection loop driven by config options stored on
 * `state`. Mutates the retained KernelRuntime reference so kernelStatus()
 * can observe reconnect progress without a SessionStore update.
 *
 * @spec-id europa.kernel.server-client.reconnection
 */
export async function runReconnectLoop(
  state: WSConnectionState,
  onSocketSwap?: (s: WebSocket) => void,
): Promise<void> {
  const runtime = state.wsRuntime;
  if (!runtime) return;

  const max = state.wsReconnectMaxRetries;
  const signal = runtime.abort.signal;

  if (max === 0) {
    runtime.info.state = "disconnected";
    return;
  }

  runtime.info.state = "reconnecting";

  for (let attempt = 1; attempt <= max; attempt++) {
    if (signal.aborted) break;

    runtime.reconnect = { retry: attempt, max };

    const waitMs = state.wsReconnectInitialIntervalMs *
      Math.pow(state.wsReconnectMultiplier, attempt - 1);

    try {
      await delay(waitMs, { signal });
    } catch {
      break;
    }

    if (signal.aborted) break;

    try {
      const result = await connectWS(
        state.wsUrl!,
        state.wsSubprotocols,
        signal,
        state.kernelInfoTimeoutMs,
      );
      const oldSocket = state.wsSocket;
      runtime.socket = result.socket;
      runtime.info.state = "idle";
      delete runtime.reconnect;
      // Detach the persistent message listener from the old socket because
      // failing to do so causes the receive op on the dropped connection
      // to linger until GC, leaking the socket resource.
      if (oldSocket !== null) {
        detachMessageListener(state, oldSocket);
      }
      state.wsSocket = result.socket;
      attachMessageListener(state, result.socket);
      // Re-attach the reconnect loop to the new socket so subsequent
      // disconnects are also handled.
      attachReconnectLoop(state, result.socket, onSocketSwap);
      onSocketSwap?.(result.socket);
      return;
    } catch {
      // continue to next attempt
    }
  }

  runtime.info.state = "disconnected";
  delete runtime.reconnect;
}
