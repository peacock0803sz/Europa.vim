/**
 * kernel_info_request/reply helpers.
 *
 * `kernelInfoInner` sends a kernel_info_request on the current socket and
 * resolves when a matching reply arrives (no timeout — the caller wraps with
 * AbortSignal.timeout).
 *
 * `kernelInfo` is the public-facing wrapper that adds the timeout and
 * converts DOMException(TimeoutError) into EuropaKernelError.
 *
 * Extracted from ServerKernelClient to keep the class under 400 lines.
 * No imports from server-client.ts (no circular dependency).
 *
 * @module europa-kernel-kernel-info-request
 * @category Kernel
 */

import type {
  KernelInfoReply,
  KernelMessage,
} from "../../../schema/message.ts";
import type { WSConnectionState } from "./ws-types.ts";
import { EuropaKernelError } from "./errors.ts";
import { encodeDefault } from "./wire/protocol-default.ts";
import { encodeV1 } from "./wire/protocol-v1.ts";
import { onMessage } from "./message-dispatch.ts";

/**
 * Send a kernel_info_request on the socket stored in `state` and resolve
 * when a matching kernel_info_reply arrives.
 *
 * Retries every 1 s until a matching reply arrives. No timeout is applied
 * here — the caller (kernelInfo) wraps with AbortSignal.timeout.
 * Uses the onMessage pub/sub so the socket message listener must already be
 * attached before this is called.
 */
export function kernelInfoInner(
  state: WSConnectionState,
  signal: AbortSignal,
): Promise<KernelInfoReply> {
  const socket = state.wsSocket;
  const isV1 = state.wsSubprotocol === "v1";

  return new Promise<KernelInfoReply>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const msgId = crypto.randomUUID();
    const clientSession = crypto.randomUUID();
    let resendId: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      unsub();
      if (resendId !== undefined) {
        clearInterval(resendId);
        resendId = undefined;
      }
    };

    const unsub = onMessage(state, (msg) => {
      if (msg.header.msg_type !== "kernel_info_reply") return;
      const parentMsgId = (msg.parent_header as Record<string, unknown>)
        ?.msg_id;
      if (parentMsgId !== msgId) return;
      cleanup();
      resolve(msg.content as unknown as KernelInfoReply);
    });

    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const sendRequest = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const req: KernelMessage = {
        header: {
          msg_id: msgId,
          msg_type: "kernel_info_request",
          username: "europa",
          session: clientSession,
          date: new Date().toISOString(),
          version: "5.3",
        },
        parent_header: {},
        metadata: {},
        content: {},
        buffers: [],
      };
      if (isV1) {
        socket.send(new Uint8Array(encodeV1(req)));
      } else {
        socket.send(encodeDefault(req));
      }
    };

    // Send immediately, then retry every 1 s until the reply arrives.
    sendRequest();
    resendId = setInterval(sendRequest, 1_000);
  });
}

/**
 * Public wrapper around `kernelInfoInner`.
 *
 * Adds `kernelInfoTimeoutMs` deadline and translates DOMException(TimeoutError)
 * into `EuropaKernelError("KERNEL_INFO_TIMEOUT")`.
 *
 * Requires `state.wsSocket` to be open and the message listener to be attached.
 *
 * @spec-id europa.kernel.server-client.kernel-info-public
 */
export async function kernelInfo(
  state: WSConnectionState,
): Promise<KernelInfoReply> {
  if (!state.wsSocket || state.wsSocket.readyState !== WebSocket.OPEN) {
    throw new EuropaKernelError(
      "KERNEL_INFO_FAILED",
      "kernelInfo: not connected — call start() first",
    );
  }
  const signals: AbortSignal[] = [
    AbortSignal.timeout(state.kernelInfoTimeoutMs),
  ];
  // wsAbort is set by start() before kernelInfo() is called; wsRuntime is only
  // populated after a successful handshake, so it cannot be used here.
  if (state.wsAbort) signals.push(state.wsAbort.signal);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  try {
    return await kernelInfoInner(state, signal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new EuropaKernelError(
        "KERNEL_INFO_TIMEOUT",
        `kernel_info_reply not received within ${state.kernelInfoTimeoutMs}ms`,
      );
    }
    throw e;
  }
}
