/**
 * AsyncIterable execute layer for Jupyter kernel execution.
 *
 * Exports:
 *   - execute(runtime, code, opts?) — async generator yielding iopub + shell messages
 *   - applyMessageToCell(cell, msg) — pure function applying a message to cell outputs
 *   - buildExecuteRequest(code) — builds fixed R02 content
 *   - buildKernelMessage(...) — builds a full KernelMessage envelope
 *
 * @module denops/europa/kernel/execute
 * @category Kernel
 */

import { v7 } from "@std/uuid";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";
import type { CodeCell } from "../../../schema/notebook.ts";
import type {
  DisplayDataContent,
  ErrorContent,
  ExecuteInputContent,
  ExecuteReplyContent,
  ExecuteRequestContent,
  ExecuteResultContent,
  KernelMessage,
  StreamContent,
} from "../../../schema/message.ts";
import { encodeV1 } from "./wire/protocol-v1.ts";
import { encodeDefault } from "./wire/protocol-default.ts";

/**
 * Build execute_request content with R02 fixed fields.
 *
 * All 6 fields are fixed per the Jupyter Messaging Protocol spec R02:
 * silent=false, store_history=true, allow_stdin=false, stop_on_error=true.
 */
export function buildExecuteRequest(code: string): ExecuteRequestContent {
  return {
    code,
    silent: false,
    store_history: true,
    user_expressions: {},
    allow_stdin: false,
    stop_on_error: true,
  };
}

/**
 * Build a KernelMessage envelope with the given msg_type and content.
 */
export function buildKernelMessage(
  msgType: string,
  msgId: string,
  sessionId: string,
  content: Record<string, unknown>,
): KernelMessage {
  return {
    header: {
      msg_id: msgId,
      msg_type: msgType,
      username: "europa",
      session: sessionId,
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: {},
    metadata: {},
    content,
    buffers: [],
  };
}

/**
 * Execute code on the kernel via the WebSocket channel.
 *
 * Sends a single execute_request (SC-007: 1 message per execute call) and
 * yields each iopub + shell message that has parent_header.msg_id === msgId.
 * Terminates when execute_reply is received and the message buffer is drained.
 *
 * The opts.msgId must be the same UUID registered in pendingRequests (FR-003 shared UUID).
 * When omitted (tests), an internal v7 UUID is generated.
 *
 * @param runtime - The live kernel runtime (socket, subprotocol, sessionId)
 * @param code - Code to execute (snapshotted at call time per Q-edit)
 * @param opts - Optional AbortSignal and pre-assigned msgId
 * @throws DOMException(AbortError) if opts.signal fires during execution
 * @spec-id europa.kernel.execute.request-msg-id-unique
 * @spec-id europa.kernel.execute.abort-mid-stream
 * @spec-id europa.kernel.execute.wire-message-count
 */
export async function* execute(
  runtime: KernelRuntime,
  code: string,
  opts?: { signal?: AbortSignal; msgId?: string },
): AsyncIterable<KernelMessage> {
  const msgId = opts?.msgId ?? v7.generate();
  const content = buildExecuteRequest(code);
  const envelope = buildKernelMessage(
    "execute_request",
    msgId,
    runtime.info.sessionId,
    content as unknown as Record<string, unknown>,
  );

  const buffer: KernelMessage[] = [];
  let resolveNext: ((msg: KernelMessage) => void) | null = null;
  let receivedReply = false;
  // receivedIdle: set when IOPub status:idle arrives for this msg_id.
  // Prevents the iterator from exiting before status:idle is delivered when
  // execute_reply (shell channel) arrives first (T016a invariant).
  let receivedIdle = false;

  // Check before subscribing to avoid an orphaned onMessage listener: if the
  // signal is already aborted, the throw happens before the try/finally block
  // that calls unsubscribe(), so the listener would otherwise leak.
  opts?.signal?.throwIfAborted();

  const unsubscribe = runtime.client.onMessage((msg) => {
    const ph = msg.parent_header as { msg_id?: string };
    if (!ph || ph.msg_id !== msgId) return;

    if (msg.header.msg_type === "execute_reply") receivedReply = true;
    if (
      msg.header.msg_type === "status" &&
      (msg.content as { execution_state?: string }).execution_state === "idle"
    ) receivedIdle = true;

    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(msg);
    } else {
      buffer.push(msg);
    }
  });

  // SC-007: send exactly one execute_request
  const encoded = runtime.info.subprotocol === "v1"
    ? new Uint8Array(encodeV1(envelope))
    : encodeDefault(envelope);

  try {
    runtime.socket.send(encoded);
    while (!receivedReply || !receivedIdle || buffer.length > 0) {
      opts?.signal?.throwIfAborted();

      const msg = buffer.shift() ??
        await new Promise<KernelMessage>((resolve, reject) => {
          const onAbort = () => {
            resolveNext = null;
            reject(new DOMException("Aborted", "AbortError"));
          };
          // Wrap resolve so the abort listener is removed on normal message
          // arrival, preventing N-listener accumulation over long streams.
          resolveNext = (m: KernelMessage) => {
            opts?.signal?.removeEventListener("abort", onAbort);
            resolve(m);
          };
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
        });

      yield msg;
    }
  } finally {
    unsubscribe();
  }
}

/**
 * Apply a single kernel message to a cell's outputs and execution_count.
 *
 * Implements the output mutation rules from execute-message-flow.md:
 * - status: no-op (caller tracks execState separately)
 * - execute_input: pre-fill execution_count
 * - stream: per-message late-merge (FR-016 / R03)
 * - display_data: append (FR-017: transient.display_id ignored)
 * - execute_result: append + set execution_count
 * - error: append traceback as-is (FR-018: no ANSI stripping)
 * - update_display_data: silent drop (Phase 5)
 * - execute_reply: reflect execution_count when status is ok/error
 *
 * @spec-id europa.kernel.execute.iopub-stream
 * @spec-id europa.kernel.execute.execute-result
 * @spec-id europa.kernel.execute.error-content
 * @spec-id europa.kernel.execute.execute-reply-ok
 * @spec-id europa.kernel.execute.execute-reply-error
 */
export function applyMessageToCell(cell: CodeCell, msg: KernelMessage): void {
  switch (msg.header.msg_type) {
    case "status": {
      break;
    }
    case "execute_input": {
      const c = msg.content as unknown as ExecuteInputContent;
      cell.execution_count = c.execution_count;
      break;
    }
    case "stream": {
      const c = msg.content as unknown as StreamContent;
      const last = cell.outputs[cell.outputs.length - 1];
      if (last && last.output_type === "stream" && last.name === c.name) {
        // FR-016: per-message late-merge for same-name stream
        (last as { text: string }).text += c.text;
      } else {
        cell.outputs.push({
          output_type: "stream",
          name: c.name,
          text: c.text,
        });
      }
      break;
    }
    case "display_data": {
      const c = msg.content as unknown as DisplayDataContent;
      cell.outputs.push({
        output_type: "display_data",
        // deno-lint-ignore no-explicit-any
        data: c.data as any,
        // deno-lint-ignore no-explicit-any
        metadata: c.metadata as any,
      });
      break;
    }
    case "execute_result": {
      const c = msg.content as unknown as ExecuteResultContent;
      cell.execution_count = c.execution_count;
      cell.outputs.push({
        output_type: "execute_result",
        execution_count: c.execution_count,
        // deno-lint-ignore no-explicit-any
        data: c.data as any,
        // deno-lint-ignore no-explicit-any
        metadata: c.metadata as any,
      });
      break;
    }
    case "error": {
      const c = msg.content as unknown as ErrorContent;
      cell.outputs.push({
        output_type: "error",
        ename: c.ename,
        evalue: c.evalue,
        traceback: c.traceback,
      });
      break;
    }
    case "update_display_data": {
      // FR-017: silent drop (Phase 5 implements display_id tracking)
      break;
    }
    case "execute_reply": {
      const c = msg.content as unknown as ExecuteReplyContent;
      if (c.status !== "aborted" && c.execution_count !== undefined) {
        cell.execution_count = c.execution_count!;
      }
      break;
    }
    default: {
      // Unknown msg_type: silent drop per FR-021 spirit
      break;
    }
  }
}
