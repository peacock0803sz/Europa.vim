/**
 * Minimal Jupyter wire-protocol codec helpers for mock/test use.
 *
 * Extracted from mock-kernel.ts so codec functions can be imported independently
 * from the mock server machinery.
 *
 * Supports v1 binary offset-table frames and the default text-JSON protocol.
 *
 * @module tests/fixtures/mock-wire-codec
 */

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ---------------------------------------------------------------------------
// v1 binary subprotocol codec
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Default (text JSON) subprotocol codec
// ---------------------------------------------------------------------------

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
