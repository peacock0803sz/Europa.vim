/**
 * Jupyter wire protocol default — text JSON codec.
 *
 * Lossy: binary buffers are dropped on encode (with a warning). This is
 * acceptable for Phase 3.2 which only uses kernel_info_request/reply, but
 * callers must not rely on buffers round-tripping through this codec.
 *
 * @module europa-kernel-wire-default
 * @category Kernel
 */

import type { KernelMessage } from "../../../../schema/message.ts";

/**
 * Encode a KernelMessage as a Jupyter default (text JSON) frame.
 *
 * Binary buffers are silently dropped. Supply `onBuffersDropped` to capture
 * the warning in tests instead of relying on console.warn side-effects.
 *
 * @param msg - Message to encode
 * @param onBuffersDropped - Optional callback called with the warning string
 *                           when buffers are present (default: console.warn)
 * @returns JSON string
 * @category Kernel
 * @spec-id europa.kernel.wire-default.encode
 * @spec-id europa.kernel.wire-default.buffers-warning
 */
export function encodeDefault(
  msg: KernelMessage,
  onBuffersDropped?: (warning: string) => void,
): string {
  if (msg.buffers.length > 0) {
    const w =
      `encodeDefault: dropping ${msg.buffers.length} buffer(s) — default protocol cannot carry binary buffers`;
    if (onBuffersDropped) {
      onBuffersDropped(w);
    } else {
      console.warn(w);
    }
  }

  return JSON.stringify({
    header: msg.header,
    parent_header: msg.parent_header,
    metadata: msg.metadata,
    content: msg.content,
  });
}

/**
 * Decode a Jupyter default (text JSON) frame into a KernelMessage.
 *
 * Always returns `buffers: []` — the default protocol carries no binary data.
 *
 * @param text - JSON string from WebSocket text frame
 * @returns KernelMessage with empty buffers array
 * @category Kernel
 * @spec-id europa.kernel.wire-default.decode
 * @spec-id europa.kernel.wire-default.roundtrip
 */
export function decodeDefault(text: string): KernelMessage {
  const obj = JSON.parse(text) as Record<string, unknown>;
  return {
    header: (obj.header ?? {}) as KernelMessage["header"],
    parent_header: (obj.parent_header ?? {}) as KernelMessage["parent_header"],
    metadata: (obj.metadata ?? {}) as Record<string, unknown>,
    content: (obj.content ?? {}) as Record<string, unknown>,
    buffers: [],
  };
}
