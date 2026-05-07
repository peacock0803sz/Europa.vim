/**
 * WebSocket message listener attach/detach helpers and onMessage pub/sub.
 *
 * Extracted from ServerKernelClient to keep the class under 400 lines.
 * Functions take a `WSConnectionState`-compatible object so the concrete
 * class is not imported (no circular dependency).
 *
 * @module europa-kernel-message-dispatch
 * @category Kernel
 */

import type { KernelMessage } from "../../../schema/message.ts";
import type { WSConnectionState } from "./ws-types.ts";
import { decodeDefault } from "./wire/protocol-default.ts";
import { decodeV1 } from "./wire/protocol-v1.ts";

/**
 * Attach a persistent message listener to `socket` that decodes incoming
 * frames and dispatches them to all registered handlers in `state`.
 *
 * Stores the listener in `state.wsPersistentMessageHandler` so it can be
 * removed later via `detachMessageListener`.
 */
export function attachMessageListener(
  state: WSConnectionState,
  socket: WebSocket,
): void {
  const handler = (e: MessageEvent): void => {
    let msg: KernelMessage;
    try {
      if (e.data instanceof ArrayBuffer) {
        msg = decodeV1(new Uint8Array(e.data));
      } else {
        msg = decodeDefault(e.data as string);
      }
    } catch {
      return;
    }
    for (const h of state.wsMessageHandlers) h(msg);
  };
  state.wsPersistentMessageHandler = handler;
  socket.addEventListener("message", handler);
}

/**
 * Remove the persistent message listener stored in `state` from `socket`.
 *
 * Callers must invoke this before reassigning the socket (e.g. on reconnect
 * WS swap, kernelInfo failure, or shutdown) to release the receive op.
 */
export function detachMessageListener(
  state: WSConnectionState,
  socket: WebSocket,
): void {
  const handler = state.wsPersistentMessageHandler;
  if (handler !== null) {
    socket.removeEventListener("message", handler);
    state.wsPersistentMessageHandler = null;
  }
}

/**
 * Subscribe `handler` to incoming KernelMessage events dispatched via
 * `state.wsMessageHandlers`.
 *
 * @returns Idempotent unsubscribe function.
 */
export function onMessage(
  state: WSConnectionState,
  handler: (msg: KernelMessage) => void,
): () => void {
  state.wsMessageHandlers.add(handler);
  return () => {
    state.wsMessageHandlers.delete(handler);
  };
}
