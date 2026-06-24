/**
 * Jupyter ZMQ multipart wire codec + HMAC-SHA256 signing.
 *
 * Sibling of protocol-v1.ts / protocol-default.ts (WebSocket codecs); shares
 * only the KernelMessage type, never their frame shape. Frame layout:
 * [...identities, "<IDS|MSG>", sig_hex, header, parent_header, metadata,
 * content, ...buffers]. HMAC uses node:crypto (FFI-free).
 *
 * @module europa-kernel-wire-zmq
 * @category Kernel
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { KernelMessage } from "../../../../schema/message.ts";
import { EuropaKernelError } from "../errors.ts";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const DELIMITER = "<IDS|MSG>";

/**
 * Compute the HMAC signature (hex bytes) over the 4 serialized message dicts.
 *
 * @param key - HMAC key from connection_file (empty string returns an empty signature)
 * @param scheme - 'hmac-sha256' (the hash name after the 'hmac-' prefix)
 * @param parts - [header, parent_header, metadata, content] serialized bytes, in order
 * @returns signature as hex-encoded bytes, or an empty Uint8Array when key is empty
 * @category Kernel
 * @spec-id europa.kernel.wire-zmq.hmac-sign
 */
export function signZmq(
  key: string,
  scheme: string,
  parts: Uint8Array[],
): Uint8Array {
  if (key === "") return new Uint8Array(0);
  const hmac = createHmac(scheme.replace(/^hmac-/, ""), key);
  for (const p of parts) hmac.update(p);
  return ENC.encode(hmac.digest("hex"));
}

/**
 * Verify a received signature against the 4 serialized dicts in constant time.
 *
 * @returns true when the signature matches; false on any length or value mismatch
 * @category Kernel
 */
export function verifyZmq(
  key: string,
  scheme: string,
  signature: Uint8Array,
  parts: Uint8Array[],
): boolean {
  const expected = signZmq(key, scheme, parts);
  // Fold a length mismatch to false: timingSafeEqual throws on unequal lengths.
  if (expected.byteLength !== signature.byteLength) return false;
  return timingSafeEqual(expected, signature);
}

/**
 * Encode a KernelMessage as a Jupyter ZMQ multipart frame.
 *
 * @param msg - message envelope (from buildKernelMessage)
 * @param key - HMAC key from connection_file (empty string = unsigned)
 * @param scheme - signature_scheme, only 'hmac-sha256' is supported
 * @param identities - optional leading routing frames (omitted for a client DEALER)
 * @returns the multipart frame as Uint8Array[]
 * @category Kernel
 * @spec-id europa.kernel.wire-zmq.encode
 */
export function encodeZmq(
  msg: KernelMessage,
  key: string,
  scheme: string,
  identities: Uint8Array[] = [],
): Uint8Array[] {
  // Serialize each dict exactly once: the HMAC must cover the exact bytes on the
  // wire, or JSON key-order drift would make the kernel reject every message.
  const h = ENC.encode(JSON.stringify(msg.header));
  const p = ENC.encode(JSON.stringify(msg.parent_header));
  const m = ENC.encode(JSON.stringify(msg.metadata));
  const c = ENC.encode(JSON.stringify(msg.content));
  const sig = signZmq(key, scheme, [h, p, m, c]);
  return [
    ...identities,
    ENC.encode(DELIMITER),
    sig,
    h,
    p,
    m,
    c,
    ...msg.buffers,
  ];
}

/**
 * Decode a Jupyter ZMQ multipart frame into a KernelMessage.
 *
 * Scans for the <IDS|MSG> delimiter (allowing 0..N leading identity frames),
 * verifies the HMAC over the received bytes (skipped for an empty key), then
 * parses the 4 dicts and keeps any trailing binary buffers as raw bytes.
 *
 * @param frames - multipart frame received from a ZMQ socket
 * @param key - HMAC key from connection_file (empty string skips verify)
 * @param scheme - signature_scheme, only 'hmac-sha256' is supported
 * @returns the decoded KernelMessage
 * @throws EuropaKernelError ZMQ_SIGNATURE_MISMATCH when a non-empty-key signature fails to verify
 * @category Kernel
 * @spec-id europa.kernel.wire-zmq.decode
 * @spec-id europa.kernel.wire-zmq.hmac-verify-reject
 * @spec-id europa.kernel.wire-zmq.unsigned-empty-key
 * @spec-id europa.kernel.wire-zmq.binary-buffers
 */
export function decodeZmq(
  frames: Uint8Array[],
  key: string,
  scheme: string,
): KernelMessage {
  let idx = -1;
  for (let i = 0; i < frames.length; i++) {
    if (DEC.decode(frames[i]) === DELIMITER) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    throw new EuropaKernelError(
      "ZMQ_SIGNATURE_MISMATCH",
      "ZMQ frame missing the <IDS|MSG> delimiter",
    );
  }

  const sig = frames[idx + 1];
  const h = frames[idx + 2];
  const p = frames[idx + 3];
  const m = frames[idx + 4];
  const c = frames[idx + 5];
  const buffers = frames.slice(idx + 6);

  // Verify against the received bytes themselves; never re-serialize (would
  // drift key order and break the digest, the mirror of serialize-once).
  if (key !== "" && !verifyZmq(key, scheme, sig, [h, p, m, c])) {
    throw new EuropaKernelError(
      "ZMQ_SIGNATURE_MISMATCH",
      "received ZMQ message failed HMAC verification",
    );
  }

  return {
    header: JSON.parse(DEC.decode(h)) as KernelMessage["header"],
    parent_header: JSON.parse(DEC.decode(p)) as KernelMessage["parent_header"],
    metadata: JSON.parse(DEC.decode(m)) as Record<string, unknown>,
    content: JSON.parse(DEC.decode(c)) as Record<string, unknown>,
    buffers,
  };
}
