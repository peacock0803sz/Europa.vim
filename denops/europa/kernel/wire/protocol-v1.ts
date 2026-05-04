/**
 * Jupyter wire protocol v1 — binary offset-table codec.
 *
 * Frame layout (all integers uint32 little-endian):
 *   [0..3]      offset_count      number of offsets = 6 + buffers.length
 *   [4..]       offsets[N]        byte positions of each frame part
 *               order: channel, header, parent_header, metadata, content, buffer[0..], sentinel
 *   [offsets[0]..] channel        UTF-8 string ('shell' | 'iopub' | etc.)
 *   [offsets[1]..] header         UTF-8 JSON
 *   [offsets[2]..] parent_header  UTF-8 JSON
 *   [offsets[3]..] metadata       UTF-8 JSON
 *   [offsets[4]..] content        UTF-8 JSON
 *   [offsets[5]..] buffer[0..N]   raw bytes
 *   offsets[offset_count-1]       sentinel = total frame length
 *
 * Only little-endian is supported (Jupyter wire protocol v1 spec).
 *
 * @module europa-kernel-wire-v1
 * @category Kernel
 */

import type { KernelMessage } from "../../../../schema/message.ts";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * Encode a KernelMessage as a Jupyter wire protocol v1 binary frame.
 *
 * @param msg - Message to encode
 * @param channel - Channel name (default: 'shell')
 * @returns Binary frame as Uint8Array
 * @category Kernel
 * @spec-id europa.kernel.wire-v1.encode
 */
export function encodeV1(msg: KernelMessage, channel = "shell"): Uint8Array {
  const parts: Uint8Array[] = [
    ENC.encode(channel),
    ENC.encode(JSON.stringify(msg.header)),
    ENC.encode(JSON.stringify(msg.parent_header)),
    ENC.encode(JSON.stringify(msg.metadata)),
    ENC.encode(JSON.stringify(msg.content)),
    ...msg.buffers,
  ];

  // offset_count = number of parts + 1 sentinel
  const offsetCount = parts.length + 1;
  // Header: offset_count field (4 bytes) + offsets array (offsetCount × 4 bytes)
  const headerBytes = 4 + offsetCount * 4;

  let totalSize = headerBytes;
  for (const p of parts) totalSize += p.byteLength;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, offsetCount, true); // offset_count (LE)

  let cursor = headerBytes;
  for (let i = 0; i < parts.length; i++) {
    view.setUint32(4 + i * 4, cursor, true); // offset[i] (LE)
    out.set(parts[i], cursor);
    cursor += parts[i].byteLength;
  }
  // Sentinel: last offset = total length
  view.setUint32(4 + parts.length * 4, cursor, true);

  return out;
}

/**
 * Decode a Jupyter wire protocol v1 binary frame into a KernelMessage.
 *
 * @param buf - Binary frame from WebSocket
 * @returns Decoded KernelMessage
 * @throws TypeError if the frame is too short to contain the offset header
 * @category Kernel
 * @spec-id europa.kernel.wire-v1.decode
 * @spec-id europa.kernel.wire-v1.roundtrip
 * @spec-id europa.kernel.wire-v1.binary-buffers
 */
export function decodeV1(buf: Uint8Array): KernelMessage {
  if (buf.byteLength < 8) {
    throw new TypeError("v1 frame too short to contain offset header");
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offsetCount = view.getUint32(0, true);

  const offsets: number[] = [];
  for (let i = 0; i <= offsetCount; i++) {
    offsets.push(view.getUint32(4 + i * 4, true));
  }

  // Slice part i: from offsets[i] to offsets[i+1]
  function sliceStr(i: number): string {
    return DEC.decode(buf.slice(offsets[i], offsets[i + 1]));
  }
  function sliceBin(i: number): Uint8Array {
    return buf.slice(offsets[i], offsets[i + 1]);
  }

  // Parts order: channel(0), header(1), parent_header(2), metadata(3), content(4), buffers(5+)
  // The last offset (offsets[offsetCount-1]) is the sentinel; parts are at indices 0..offsetCount-2
  const buffers: Uint8Array[] = [];
  for (let i = 5; i < offsetCount - 1; i++) {
    buffers.push(sliceBin(i));
  }

  return {
    header: JSON.parse(sliceStr(1)),
    parent_header: JSON.parse(sliceStr(2)),
    metadata: JSON.parse(sliceStr(3)),
    content: JSON.parse(sliceStr(4)),
    buffers,
  };
}
