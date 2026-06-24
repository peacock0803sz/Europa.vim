/**
 * In-memory Jupyter ZMQ multipart codec + HMAC for mock/test use.
 *
 * Mirrors the real `wire/protocol-zmq.ts` frame format byte-for-byte so specs
 * can verify interop (encode here, decode there, and vice versa) without the
 * zeromq native binding. HMAC uses node:crypto, which is FFI-free.
 *
 * Frame: [...identities, "<IDS|MSG>", sig_hex, header, parent, metadata,
 * content, ...buffers]
 *
 * @module tests/fixtures/mock-zmq-codec
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MockKernelMessage } from "./mock-wire-codec.ts";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** ZMQ identity/payload boundary delimiter (constant). */
export const ZMQ_DELIMITER = "<IDS|MSG>";

/**
 * Compute the HMAC-SHA256 signature (hex bytes) over the 4 serialized dicts.
 * An empty key returns an empty signature (unsigned kernel).
 */
export function signZmqMock(
  key: string,
  scheme: string,
  parts: Uint8Array[],
): Uint8Array {
  if (key === "") return new Uint8Array(0);
  const hash = scheme.replace(/^hmac-/, ""); // 'hmac-sha256' -> 'sha256'
  const hmac = createHmac(hash, key);
  for (const p of parts) hmac.update(p);
  return ENC.encode(hmac.digest("hex"));
}

/** Constant-time verify of a received signature against the 4 serialized dicts. */
export function verifyZmqMock(
  key: string,
  scheme: string,
  signature: Uint8Array,
  parts: Uint8Array[],
): boolean {
  const expected = signZmqMock(key, scheme, parts);
  // Fold a length mismatch to false: timingSafeEqual throws on unequal lengths.
  if (expected.byteLength !== signature.byteLength) return false;
  return timingSafeEqual(expected, signature);
}

/**
 * Encode a MockKernelMessage as a Jupyter ZMQ multipart frame.
 * Serialize-once: the same 4 byte arrays feed both the signer and the frames.
 */
export function encodeZmqMock(
  msg: MockKernelMessage,
  key: string,
  scheme: string,
  identities: Uint8Array[] = [],
): Uint8Array[] {
  const h = ENC.encode(JSON.stringify(msg.header));
  const p = ENC.encode(JSON.stringify(msg.parent_header));
  const m = ENC.encode(JSON.stringify(msg.metadata));
  const c = ENC.encode(JSON.stringify(msg.content));
  const sig = signZmqMock(key, scheme, [h, p, m, c]);
  return [...identities, ENC.encode(ZMQ_DELIMITER), sig, h, p, m, c, ...msg.buffers];
}

/**
 * Decode a Jupyter ZMQ multipart frame into a MockKernelMessage. With a
 * non-empty key, throws on signature mismatch; an empty key skips verify.
 */
export function decodeZmqMock(
  frames: Uint8Array[],
  key: string,
  scheme: string,
): MockKernelMessage {
  let idx = -1;
  for (let i = 0; i < frames.length; i++) {
    if (DEC.decode(frames[i]) === ZMQ_DELIMITER) {
      idx = i;
      break;
    }
  }
  if (idx === -1) throw new Error("mock-zmq: <IDS|MSG> delimiter not found");

  const sig = frames[idx + 1];
  const h = frames[idx + 2];
  const p = frames[idx + 3];
  const m = frames[idx + 4];
  const c = frames[idx + 5];
  const buffers = frames.slice(idx + 6);

  if (key !== "" && !verifyZmqMock(key, scheme, sig, [h, p, m, c])) {
    throw new Error("mock-zmq: HMAC signature mismatch");
  }

  return {
    header: JSON.parse(DEC.decode(h)),
    parent_header: JSON.parse(DEC.decode(p)),
    metadata: JSON.parse(DEC.decode(m)),
    content: JSON.parse(DEC.decode(c)),
    buffers,
  };
}
