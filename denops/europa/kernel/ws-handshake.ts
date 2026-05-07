/**
 * WebSocket open/connect helpers used during kernel start and reconnection.
 *
 * `openWS` resolves on the "open" event (subprotocol negotiation only).
 * `connectWS` additionally waits for the first kernel_info_reply
 * (used by the legacy reconnect path).
 * `closeAndWait` ensures the WS is fully closed before resolving.
 *
 * Extracted from ServerKernelClient to keep the class under 400 lines.
 * No imports from server-client.ts (no circular dependency).
 *
 * @module europa-kernel-ws-handshake
 * @category Kernel
 */

import type { KernelMessage } from "../../../schema/message.ts";
import { EuropaKernelError } from "./errors.ts";
import { decodeDefault } from "./wire/protocol-default.ts";
import { decodeV1 } from "./wire/protocol-v1.ts";
import { encodeDefault } from "./wire/protocol-default.ts";
import { encodeV1 } from "./wire/protocol-v1.ts";

export type ConnectResult = {
  socket: WebSocket;
  subprotocol: "v1" | "default";
  content: Record<string, unknown>;
};

export type OpenResult = {
  socket: WebSocket;
  subprotocol: "v1" | "default";
};

/**
 * Closes a WebSocket and resolves once the close event fires (or
 * immediately if it is already CLOSED). Mirrors the close-await pattern in
 * `connectWS.rejectAfterClose` so callers in error/shutdown paths do not
 * leak in-flight WS receive ops past the test boundary.
 */
export function closeAndWait(
  socket: WebSocket,
  code: number,
  reason: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.addEventListener("close", () => resolve(), { once: true });
    try {
      socket.close(code, reason);
    } catch {
      // already closing — close listener will still fire
    }
  });
}

/**
 * Opens a WebSocket and resolves on the "open" event with socket + subprotocol.
 * Does NOT perform the kernel_info handshake — use kernelInfo() for that.
 */
export function openWS(
  wsUrl: string,
  subprotocols: string[],
  signal: AbortSignal,
): Promise<OpenResult> {
  return new Promise<OpenResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new EuropaKernelError(
          "KERNEL_INFO_TIMEOUT",
          "Aborted before WebSocket connect",
        ),
      );
      return;
    }

    let settled = false;
    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
      }
    };

    const rejectAfterClose = (err: EuropaKernelError) => {
      done(() => {
        if (ws.readyState === WebSocket.CLOSED) {
          reject(err);
        } else {
          ws.addEventListener("close", () => reject(err), { once: true });
          try {
            ws.close();
          } catch { /* already closing */ }
        }
      });
    };

    const onAbort = () =>
      rejectAfterClose(
        new EuropaKernelError(
          "KERNEL_INFO_TIMEOUT",
          "Start aborted by signal",
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });

    const ws = new WebSocket(wsUrl, subprotocols);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("error", () => {
      const err = new EuropaKernelError(
        "CONNECTION_REFUSED",
        "WebSocket connection failed",
      );
      if (ws.readyState === WebSocket.CLOSED) {
        done(() => reject(err));
      } else {
        ws.addEventListener("close", () => done(() => reject(err)), {
          once: true,
        });
      }
    });

    ws.addEventListener("close", (ev) => {
      // Only reject before open fires; after open the reconnect loop owns close.
      done(() =>
        reject(
          new EuropaKernelError(
            "CONNECTION_REFUSED",
            `WebSocket closed before open: ${ev.code}`,
          ),
        )
      );
    });

    ws.addEventListener("open", () => {
      const proto = ws.protocol;
      const isV1 = proto !== "" && proto.startsWith("v1");
      done(() => resolve({ socket: ws, subprotocol: isV1 ? "v1" : "default" }));
    });
  });
}

/**
 * Opens a WebSocket, sends kernel_info_request(s) until a reply arrives, and
 * resolves with the socket, negotiated subprotocol, and reply content.
 *
 * Used by the reconnect loop (which does not call kernelInfo() separately).
 *
 * @spec-id europa.kernel.server-client.abort-race
 */
export function connectWS(
  wsUrl: string,
  subprotocols: string[],
  signal: AbortSignal,
  kernelInfoTimeoutMs: number,
): Promise<ConnectResult> {
  return new Promise<ConnectResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new EuropaKernelError(
          "KERNEL_INFO_TIMEOUT",
          "Aborted before WebSocket connect",
        ),
      );
      return;
    }

    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let resendIntervalId: ReturnType<typeof setInterval> | undefined;
    let onMsg: ((e: MessageEvent) => void) | undefined;
    let opened = false;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (resendIntervalId !== undefined) {
        clearInterval(resendIntervalId);
        resendIntervalId = undefined;
      }
      if (onMsg !== undefined) {
        // Detach on every reject path (abort/close/timeout) so Deno's
        // test sanitizer does not flag a dangling message receive op.
        ws.removeEventListener("message", onMsg);
        onMsg = undefined;
      }
    };

    // Defer reject until the WS is fully closed to prevent cross-test resource leaks.
    const rejectAfterClose = (err: EuropaKernelError) => {
      settle(() => {
        cleanup();
        if (ws.readyState === WebSocket.CLOSED) {
          reject(err);
        } else {
          ws.addEventListener("close", () => reject(err), { once: true });
          try {
            ws.close();
          } catch { /* already closing */ }
        }
      });
    };

    const onAbort = () => {
      rejectAfterClose(
        new EuropaKernelError(
          "KERNEL_INFO_TIMEOUT",
          "Start aborted by signal",
        ),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const ws = new WebSocket(wsUrl, subprotocols);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("error", () => {
      // 'error' fires before 'close' in Deno; wait for close so WS is fully done.
      settle(() => {
        cleanup();
        const err = new EuropaKernelError(
          "CONNECTION_REFUSED",
          "WebSocket connection failed",
        );
        if (ws.readyState === WebSocket.CLOSED) {
          reject(err);
        } else {
          ws.addEventListener("close", () => reject(err), { once: true });
        }
      });
    });

    ws.addEventListener("close", (ev) => {
      settle(() => {
        cleanup();
        if (!opened) {
          reject(
            new EuropaKernelError(
              "CONNECTION_REFUSED",
              `WebSocket closed before open: ${ev.code}`,
            ),
          );
        } else {
          reject(
            new EuropaKernelError(
              "KERNEL_INFO_FAILED",
              `WebSocket closed before kernel_info_reply: ${ev.code}`,
            ),
          );
        }
      });
    });

    ws.addEventListener("open", () => {
      opened = true;
      const proto = ws.protocol;
      const isV1 = proto !== "" && proto.startsWith("v1");

      timeoutId = setTimeout(() => {
        rejectAfterClose(
          new EuropaKernelError(
            "KERNEL_INFO_TIMEOUT",
            `kernel_info_reply not received within ${kernelInfoTimeoutMs}ms`,
          ),
        );
      }, kernelInfoTimeoutMs);

      onMsg = (e: MessageEvent) => {
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

        if (msg.header.msg_type !== "kernel_info_reply") return;

        settle(() => {
          cleanup();
          resolve({
            socket: ws,
            subprotocol: isV1 ? "v1" : "default",
            content: msg.content,
          });
        });
      };

      ws.addEventListener("message", onMsg);

      const clientSession = crypto.randomUUID();
      const sendInfoRequest = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const req: KernelMessage = {
          header: {
            msg_id: crypto.randomUUID(),
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
          // new Uint8Array(typedArray) copies into a fresh ArrayBuffer,
          // satisfying strict WebSocket.send() typings in TS 5.7+.
          ws.send(new Uint8Array(encodeV1(req)));
        } else {
          ws.send(encodeDefault(req));
        }
      };

      // Send immediately, then retry every 1s until reply arrives or timeout.
      // ipykernel may not be ready to respond on the first message after WS open.
      sendInfoRequest();
      resendIntervalId = setInterval(sendInfoRequest, 1_000);
    });
  });
}
