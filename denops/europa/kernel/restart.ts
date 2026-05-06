/**
 * REST restart + WebSocket re-open for Jupyter kernel reset.
 *
 * Sends POST /api/kernels/{kid}/restart, then closes the old WebSocket and opens
 * a new one. FR-012: REST precedes WS close so 5xx leaves the old connection
 * intact and the user can fall back to manual shutdown/start (FR-013).
 *
 * @module denops/europa/kernel/restart
 * @category Kernel
 */

import type { KernelRuntime } from "../../../contracts/kernel-client.ts";
import type { KernelInfoReply } from "../../../schema/message.ts";
import { buildAuthHeader } from "./auth.ts";
import { EuropaKernelError } from "./errors.ts";
import { abortAll } from "../session/pending-requests.ts";

/**
 * Open a WebSocket and resolve when the "open" event fires.
 * Used by restart() to establish the new kernel channel.
 */
function _openWS(
  wsUrl: string,
  subprotocols: string[],
  signal: AbortSignal,
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new EuropaKernelError(
          "RESTART_HANDSHAKE_FAILED",
          "restart WS open aborted by signal",
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
          "RESTART_HANDSHAKE_FAILED",
          "restart WS open aborted",
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });

    const ws = new WebSocket(wsUrl, subprotocols);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("error", () => {
      const err = new EuropaKernelError(
        "RESTART_HANDSHAKE_FAILED",
        "restart WebSocket connection failed",
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
      done(() =>
        reject(
          new EuropaKernelError(
            "RESTART_HANDSHAKE_FAILED",
            `restart WebSocket closed before open: ${ev.code}`,
          ),
        )
      );
    });

    ws.addEventListener("open", () => {
      done(() => resolve(ws));
    });
  });
}

/**
 * Restart kernel: abort in-flight executes, POST /restart, re-open WebSocket,
 * call kernelInfo() for re-handshake, update runtime.info, and clear cell states.
 *
 * The `onSocketReopen` callback is invoked with the new WebSocket before
 * `kernelInfo()` is called. The caller uses this to update its internal socket
 * reference and attach the message listener so that kernelInfo()'s onMessage
 * subscription fires on the correct new socket.
 *
 * @param runtime - Live KernelRuntime (mutated in-place)
 * @param baseUrl - Jupyter server base URL (e.g. "http://localhost:8888")
 * @param token - Auth token for Authorization header
 * @param wsUrl - WebSocket URL for kernel channels
 * @param subprotocols - Subprotocol list for WS negotiation
 * @param onSocketReopen - Callback invoked with the new WebSocket before kernelInfo().
 * @throws EuropaKernelError(RESTART_REST_FAILED) on non-2xx REST response
 * @throws EuropaKernelError(RESTART_HANDSHAKE_FAILED) on WS open or kernelInfo failure
 * @spec-id europa.kernel.restart.rest-200
 * @spec-id europa.kernel.restart.websocket-reopen
 * @spec-id europa.kernel.restart.kernel-info-resync
 * @spec-id europa.kernel.restart.5xx-fallback
 */
export async function restart(
  runtime: KernelRuntime,
  baseUrl: string,
  token: string,
  wsUrl: string,
  subprotocols: string[],
  onSocketReopen: (newSocket: WebSocket) => void,
): Promise<void> {
  // (a) Cancel all in-flight executes; all pending cells → aborted
  runtime.abort.abort();
  abortAll(runtime);

  // (b) Fresh AbortController so REST and new execute() calls are not permanently cancelled
  runtime.abort = new AbortController();

  const url = `${baseUrl}/api/kernels/${runtime.info.kernelId}/restart`;

  // (c) POST /restart — existing WebSocket is NOT closed yet (FR-012 order)
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: buildAuthHeader(token) },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    // (d) 5xx: old WS still open so kernel is still reachable (FR-013).
    // Restore both execState and info.state: step (a) aborted the old
    // controller which fired the abort→state listener setting state to
    // "disconnected", but the socket is still functional.
    await resp.text().catch(() => {});
    runtime.execState = "idle";
    runtime.info.state = "idle";
    throw new EuropaKernelError(
      "RESTART_REST_FAILED",
      `restart REST failed: ${resp.status} ${resp.statusText}`,
    );
  }
  await resp.arrayBuffer().catch(() => {});

  // (e) 200: close old WS, open new WS
  if (runtime.socket.readyState === WebSocket.OPEN) {
    runtime.socket.close(1000);
  }

  const newSocket = await _openWS(wsUrl, subprotocols, runtime.abort.signal);
  runtime.socket = newSocket;

  // Notify caller to update its internal socket reference and attach the message
  // listener before kernelInfo() subscribes — otherwise the reply fires on the
  // stale old socket and is never seen.
  onSocketReopen(newSocket);

  // (f) Re-handshake; rethrow KERNEL_INFO_TIMEOUT as RESTART_HANDSHAKE_FAILED
  let reply: KernelInfoReply;
  try {
    reply = await runtime.client.kernelInfo();
  } catch (e) {
    runtime.execState = "idle";
    if (e instanceof EuropaKernelError && e.code === "KERNEL_INFO_TIMEOUT") {
      throw new EuropaKernelError(
        "RESTART_HANDSHAKE_FAILED",
        "restart handshake timed out after WebSocket reconnect",
        e,
      );
    }
    throw e;
  }

  // Update runtime.info from fresh reply
  const langInfo = reply.language_info;
  if (langInfo) {
    runtime.info.languageInfo = {
      name: langInfo.name,
      version: langInfo.version,
      mimetype: langInfo.mimetype,
      file_extension: langInfo.file_extension,
    };
  }
  runtime.info.banner = reply.banner;

  // (g) Clear cell states (pendingRequests were cleared by abortAll in step a)
  runtime.cellStates.clear();
  // Restore state: abort in step (a) set info.state = "disconnected" via the
  // abort listener; new WS is open and handshake succeeded, so restore "idle".
  runtime.info.state = "idle";
  runtime.execState = "idle";
}
