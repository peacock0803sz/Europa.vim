/**
 * In-process mock Jupyter server for integration tests.
 *
 * Creates a real HTTP+WebSocket server via Deno.serve() that responds to
 * Jupyter Server REST endpoints and WebSocket kernel channels. Supports both
 * the v1 binary subprotocol (offset-table frame layout) and the default JSON
 * text subprotocol.
 *
 * Usage:
 *   const mk = makeMockKernel();
 *   // mk.url === "http://127.0.0.1:<port>"
 *   // mk.token === "<random token>"
 *   // use mk.url in tests, then:
 *   await mk.close();
 *
 * @module tests/fixtures/mock-kernel
 */

import { delay } from "@std/async/delay";

// ---------------------------------------------------------------------------
// Wire protocol helpers (minimal inline — full impl lives in kernel/wire/)
// ---------------------------------------------------------------------------

/** Minimal Jupyter message shape used by the mock. */
export type MockKernelMessage = {
  header: {
    msg_id: string;
    msg_type: string;
    username: string;
    session: string;
    date: string;
    version: string;
  };
  parent_header: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  buffers: Uint8Array[];
};

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * Encode a KernelMessage in the v1 binary offset-table format.
 *
 * Frame layout: [offset_count(uint64 LE), offsets[](uint64 LE × n), channel, header, parent_header, metadata, content, ...buffers]
 * offset_count = 6 + buffers.length (channel + 4 JSON parts + sentinel)
 */
export function encodeV1Mock(msg: MockKernelMessage, channel = "shell"): Uint8Array {
  const parts = [
    ENC.encode(channel),
    ENC.encode(JSON.stringify(msg.header)),
    ENC.encode(JSON.stringify(msg.parent_header)),
    ENC.encode(JSON.stringify(msg.metadata)),
    ENC.encode(JSON.stringify(msg.content)),
    ...msg.buffers,
  ];

  const offsetCount = parts.length + 1; // parts + sentinel
  const headerBytes = 8 + offsetCount * 8; // offset_count field + offsets array

  let totalSize = headerBytes;
  for (const p of parts) totalSize += p.byteLength;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  view.setBigUint64(0, BigInt(offsetCount), true);

  let cursor = headerBytes;
  for (let i = 0; i < parts.length; i++) {
    view.setBigUint64(8 + i * 8, BigInt(cursor), true);
    buf.set(parts[i], cursor);
    cursor += parts[i].byteLength;
  }
  view.setBigUint64(8 + parts.length * 8, BigInt(cursor), true); // sentinel

  return buf;
}

/**
 * Decode a v1 binary frame into a MockKernelMessage.
 */
export function decodeV1Mock(buf: Uint8Array): MockKernelMessage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offsetCount = Number(view.getBigUint64(0, true));

  const offsets: number[] = [];
  for (let i = 0; i < offsetCount; i++) {
    offsets.push(Number(view.getBigUint64(8 + i * 8, true)));
  }

  function slice(idx: number): Uint8Array {
    return buf.slice(offsets[idx], offsets[idx + 1]);
  }

  // channel(0), header(1), parent_header(2), metadata(3), content(4), buffers(5+).
  // The last offset (offsetCount - 1) is the sentinel marking end-of-data.
  const buffers: Uint8Array[] = [];
  for (let i = 5; i < offsetCount - 1; i++) {
    buffers.push(slice(i));
  }

  return {
    header: JSON.parse(DEC.decode(slice(1))),
    parent_header: JSON.parse(DEC.decode(slice(2))),
    metadata: JSON.parse(DEC.decode(slice(3))),
    content: JSON.parse(DEC.decode(slice(4))),
    buffers,
  };
}

/** Encode a message as default (text JSON) protocol — buffers are dropped. */
export function encodeDefaultMock(msg: MockKernelMessage): string {
  return JSON.stringify({
    header: msg.header,
    parent_header: msg.parent_header,
    metadata: msg.metadata,
    content: msg.content,
  });
}

/** Decode a default (text JSON) protocol message. */
export function decodeDefaultMock(text: string): MockKernelMessage {
  const obj = JSON.parse(text);
  return {
    header: obj.header ?? {},
    parent_header: obj.parent_header ?? {},
    metadata: obj.metadata ?? {},
    content: obj.content ?? {},
    buffers: [],
  };
}

// ---------------------------------------------------------------------------
// Mock kernel factory
// ---------------------------------------------------------------------------

/** KernelInfo shape returned by GET /api/kernels/:kid */
export type MockKernelInfo = {
  id: string;
  name: string;
  last_activity: string;
  execution_state: string;
  connections: number;
};

/** Scripted reply set for a single execute_request in tests. */
export type MockExecuteScript = {
  /** The code to match (exact string). If omitted, matches any code. */
  code?: string;
  /**
   * Sequence of iopub messages to emit, in order, before execute_reply.
   * Each entry is { msg_type, content }.
   */
  replies: Array<{ msg_type: string; content: Record<string, unknown> }>;
  /** execute_reply content. Defaults to { status: "ok", execution_count: 1 }. */
  executeReply?: Record<string, unknown>;
};

/** Config for makeMockKernel(). */
export type MockKernelOptions = {
  /** Subprotocols the server will accept (first matching wins). Default: all 3. */
  acceptSubprotocols?: string[];
  /** kernel_info_reply content to send. Default: minimal Python reply. */
  kernelInfoReply?: Record<string, unknown>;
  /** If true, reject all subprotocol negotiation (for SUBPROTOCOL_REJECTED tests). */
  rejectSubprotocol?: boolean;
  /** If set, delay (ms) before sending kernel_info_reply (for KERNEL_INFO_TIMEOUT tests). */
  replyDelayMs?: number;
  /** If true, close WebSocket unexpectedly after opening (for reconnection tests). */
  closeAfterOpen?: boolean;
  /** Scripted replies for execute_request messages (Phase 3.3). */
  executeScript?: MockExecuteScript;
};

export type MockKernelHandle = {
  /** Base URL of the mock server, e.g. "http://127.0.0.1:8765" */
  url: string;
  /** Random token for Authorization header / subprotocol. */
  token: string;
  /** Session IDs for which DELETE /api/sessions/<sid> was received. */
  deletedSessions: string[];
  /** REST interrupt call count (POST /api/kernels/:kid/interrupt). */
  interruptCallTimestamps: number[];
  /** All execute_request messages received over the WebSocket. */
  executeRequestCalls: MockKernelMessage[];
  /** All inbound wire messages received (diagnostic API). */
  allWireMessages: MockKernelMessage[];
  /** Stop the server and clean up. */
  close(): Promise<void>;
};

const V1_SUBPROTOCOL = "v1.kernel.websocket.jupyter.org";
const V1_PROTOCOLS = [V1_SUBPROTOCOL];

/**
 * Start an in-process mock Jupyter server.
 *
 * Returns a handle with `url`, `token`, and `close()`. The server handles:
 *   - POST /api/sessions → 201 { id, kernel: { id } }
 *   - DELETE /api/sessions/:sid → 204
 *   - GET /api/kernels/:kid → 200 kernel metadata
 *   - GET /api/kernelspecs → 200 { default, kernelspecs: { python3: ... } }
 *   - WS /api/kernels/:kid/channels → subprotocol negotiation + kernel_info_reply
 */
export function makeMockKernel(
  opts: MockKernelOptions = {},
): MockKernelHandle {
  const token = crypto.randomUUID().replaceAll("-", "");

  // The token-suffixed subprotocol carries auth; the bare form would let a
  // tokenless client negotiate successfully and mask TOKEN_MISSING regressions.
  const acceptProtos = opts.acceptSubprotocols ?? [
    V1_SUBPROTOCOL,
    `v1.token.websocket.jupyter.org.${token}`,
  ];

  const kernelId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const deletedSessions: string[] = [];
  const interruptCallTimestamps: number[] = [];
  const executeRequestCalls: MockKernelMessage[] = [];
  const allWireMessages: MockKernelMessage[] = [];
  let executionCount = 0;

  const kernelInfoReply: Record<string, unknown> = opts.kernelInfoReply ?? {
    status: "ok",
    protocol_version: "5.3",
    implementation: "ipython",
    implementation_version: "8.0.0",
    language_info: {
      name: "python",
      version: "3.14.0",
      mimetype: "text/x-python",
      file_extension: ".py",
    },
    banner: "IPython mock kernel",
    help_links: [],
  };

  let serverController: { shutdown(): Promise<void> } | null = null;

  const handler = (req: Request): Response => {
    const url = new URL(req.url);
    const auth = req.headers.get("Authorization") ?? "";

    // Token validation (skip for WS upgrade — handled in WS handler)
    if (!auth.startsWith("token ") && !req.headers.has("upgrade")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const path = url.pathname;

    // POST /api/sessions
    if (req.method === "POST" && path === "/api/sessions") {
      return Response.json({ id: sessionId, kernel: { id: kernelId } }, { status: 201 });
    }

    // DELETE /api/sessions/:sid
    if (req.method === "DELETE" && path.startsWith("/api/sessions/")) {
      const sid = path.slice("/api/sessions/".length);
      deletedSessions.push(sid);
      return new Response(null, { status: 204 });
    }

    // GET /api/kernels/:kid (must be before POST /api/kernels/:kid/interrupt)
    if (
      req.method === "GET" && path.startsWith("/api/kernels/") &&
      !path.includes("/channels") && !path.includes("/interrupt") &&
      !path.includes("/restart")
    ) {
      const meta: MockKernelInfo = {
        id: kernelId,
        name: "python3",
        last_activity: new Date().toISOString(),
        execution_state: "idle",
        connections: 0,
      };
      return Response.json(meta);
    }

    // POST /api/kernels/:kid/interrupt → 204
    if (req.method === "POST" && path.endsWith("/interrupt")) {
      interruptCallTimestamps.push(Date.now());
      return new Response(null, { status: 204 });
    }

    // POST /api/kernels/:kid/restart → 200 + kernel JSON
    if (req.method === "POST" && path.endsWith("/restart")) {
      const kernelJson = {
        id: kernelId,
        name: "python3",
        last_activity: new Date().toISOString(),
        execution_state: "idle",
        connections: 0,
      };
      return Response.json(kernelJson, { status: 200 });
    }

    // GET /api/kernelspecs
    if (req.method === "GET" && path === "/api/kernelspecs") {
      return Response.json({
        default: "python3",
        kernelspecs: {
          python3: {
            name: "python3",
            spec: { display_name: "Python 3 (mock)", language: "python" },
          },
        },
      });
    }

    // WebSocket /api/kernels/:kid/channels
    if (req.headers.has("upgrade") && path.includes("/channels")) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Not a WebSocket upgrade", { status: 400 });
      }

      const requestedProtos = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      if (opts.rejectSubprotocol) {
        return new Response("Subprotocol rejected", { status: 426 });
      }

      const negotiated = requestedProtos.find((p) => acceptProtos.includes(p));

      if (requestedProtos.length > 0 && negotiated === undefined) {
        return new Response("Subprotocol rejected", { status: 426 });
      }

      const { socket, response } = Deno.upgradeWebSocket(req, {
        protocol: negotiated,
      });

      const isV1 = negotiated !== undefined &&
        V1_PROTOCOLS.some((_p) => negotiated.startsWith("v1"));

      // Abort any in-flight delay when the socket closes (prevents timer leaks)
      const socketAbort = new AbortController();
      socket.onclose = () => { socketAbort.abort(); };

      const sendMsg = (
        msgType: string,
        content: Record<string, unknown>,
        parentHeader: Record<string, unknown>,
        channel = "shell",
      ) => {
        const msg: MockKernelMessage = {
          header: {
            msg_id: crypto.randomUUID(),
            msg_type: msgType,
            username: "mock",
            session: sessionId,
            date: new Date().toISOString(),
            version: "5.3",
          },
          parent_header: parentHeader,
          metadata: {},
          content,
          buffers: [],
        };
        if (isV1) {
          socket.send(encodeV1Mock(msg, channel));
        } else {
          socket.send(encodeDefaultMock(msg));
        }
      };

      socket.onmessage = async (event) => {
        let msg: MockKernelMessage;
        try {
          if (event.data instanceof ArrayBuffer) {
            msg = decodeV1Mock(new Uint8Array(event.data));
          } else {
            msg = decodeDefaultMock(event.data as string);
          }
        } catch {
          return;
        }

        // Diagnostic: record all inbound wire messages
        allWireMessages.push(msg);

        if (msg.header.msg_type === "execute_request") {
          executeRequestCalls.push(msg);

          const parent = msg.header as unknown as Record<string, unknown>;
          executionCount++;
          const execCount = executionCount;

          // status:busy
          sendMsg("status", { execution_state: "busy" }, parent, "iopub");

          // execute_input echo
          sendMsg(
            "execute_input",
            { code: msg.content["code"] ?? "", execution_count: execCount },
            parent,
            "iopub",
          );

          // Scripted replies (iopub messages before execute_reply)
          if (opts.executeScript) {
            const script = opts.executeScript;
            for (const rep of script.replies) {
              sendMsg(rep.msg_type, rep.content, parent, "iopub");
            }
            const replyContent = script.executeReply ?? {
              status: "ok",
              execution_count: execCount,
              payload: [],
              user_expressions: {},
            };
            // status:idle
            sendMsg("status", { execution_state: "idle" }, parent, "iopub");
            // execute_reply on shell
            sendMsg("execute_reply", replyContent, parent, "shell");
          } else {
            // Default: minimal ok reply
            sendMsg("status", { execution_state: "idle" }, parent, "iopub");
            sendMsg(
              "execute_reply",
              {
                status: "ok",
                execution_count: execCount,
                payload: [],
                user_expressions: {},
              },
              parent,
              "shell",
            );
          }
          return;
        }

        if (msg.header.msg_type !== "kernel_info_request") return;

        if (opts.replyDelayMs && opts.replyDelayMs > 0) {
          try {
            await delay(opts.replyDelayMs, { signal: socketAbort.signal });
          } catch {
            return; // socket closed during delay
          }
        }

        if (opts.closeAfterOpen) {
          // 1006 is reserved by RFC 6455 and may not be sent in a Close frame;
          // 1011 (Server Error) lets WebSocket impls send it without throwing.
          socket.close(1011, "unexpected close");
          return;
        }

        sendMsg("kernel_info_reply", kernelInfoReply, msg.header as unknown as Record<string, unknown>, "shell");
      };

      return response;
    }

    return new Response("Not Found", { status: 404 });
  };

  // Start the server on a random port
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, handler);
  serverController = server;

  // Extract the assigned port
  const addr = server.addr as Deno.NetAddr;
  const port = addr.port;
  const serverUrl = `http://127.0.0.1:${port}`;

  return {
    url: serverUrl,
    token,
    deletedSessions,
    interruptCallTimestamps,
    executeRequestCalls,
    allWireMessages,
    async close(): Promise<void> {
      await serverController?.shutdown();
    },
  };
}
