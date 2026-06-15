/**
 * BDD specs for the ZMQ multipart wire codec + HMAC (wire/protocol-zmq.ts).
 *
 * FFI-free: node:crypto HMAC over in-memory frames, plus interop with the
 * mock codec (tests/fixtures/mock-zmq-codec.ts) to prove byte-compatibility.
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeZmq,
  encodeZmq,
  signZmq,
  verifyZmq,
} from "../../../../denops/europa/kernel/wire/protocol-zmq.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import {
  decodeZmqMock,
  encodeZmqMock,
} from "../../../fixtures/mock-zmq-codec.ts";
import type { KernelMessage } from "../../../../schema/message.ts";

const KEY = "a0b1c2d3-4e5f-6071-8293-a4b5c6d7e8f9";
const SCHEME = "hmac-sha256";
const DEC = new TextDecoder();

function makeMsg(overrides: Partial<KernelMessage> = {}): KernelMessage {
  return {
    header: {
      msg_id: "m1",
      msg_type: "execute_request",
      username: "u",
      session: "s1",
      date: "2026-06-15T00:00:00Z",
      version: "5.3",
    },
    parent_header: {},
    metadata: {},
    content: { code: "print(1)" },
    buffers: [],
    ...overrides,
  } as KernelMessage;
}

/** @spec-id europa.kernel.wire-zmq.encode */
describe("encodeZmq — frame layout", () => {
  it("places <IDS|MSG>, signature, and the 4 dicts in order", () => {
    const frames = encodeZmq(makeMsg(), KEY, SCHEME);
    assertEquals(DEC.decode(frames[0]), "<IDS|MSG>");
    // sig(1), header(2), parent(3), metadata(4), content(5)
    assertEquals(JSON.parse(DEC.decode(frames[2])).msg_id, "m1");
    assertEquals(JSON.parse(DEC.decode(frames[5])).code, "print(1)");
  });

  it("prepends identity frames when provided", () => {
    const ident = new TextEncoder().encode("routing-id");
    const frames = encodeZmq(makeMsg(), KEY, SCHEME, [ident]);
    assertEquals(DEC.decode(frames[0]), "routing-id");
    assertEquals(DEC.decode(frames[1]), "<IDS|MSG>");
  });
});

/** @spec-id europa.kernel.wire-zmq.decode */
describe("decodeZmq — roundtrip", () => {
  it("round-trips a message through encode -> decode", () => {
    const msg = makeMsg();
    const decoded = decodeZmq(encodeZmq(msg, KEY, SCHEME), KEY, SCHEME);
    assertEquals(decoded.header.msg_id, "m1");
    assertEquals(decoded.content, { code: "print(1)" });
  });

  it("skips 0..N leading identity frames via the delimiter", () => {
    const ident = new TextEncoder().encode("rid");
    const decoded = decodeZmq(
      encodeZmq(makeMsg(), KEY, SCHEME, [ident]),
      KEY,
      SCHEME,
    );
    assertEquals(decoded.header.msg_type, "execute_request");
  });
});

/** @spec-id europa.kernel.wire-zmq.hmac-sign */
describe("signZmq — HMAC signature", () => {
  it("produces a non-empty hex signature for a non-empty key", () => {
    const parts = [new TextEncoder().encode("{}")];
    const sig = signZmq(KEY, SCHEME, parts);
    assertEquals(sig.length > 0, true);
    assertEquals(verifyZmq(KEY, SCHEME, sig, parts), true);
  });
});

/** @spec-id europa.kernel.wire-zmq.hmac-verify-reject */
describe("decodeZmq — signature mismatch", () => {
  it("rejects a tampered signature with ZMQ_SIGNATURE_MISMATCH", () => {
    const frames = encodeZmq(makeMsg(), KEY, SCHEME);
    frames[1] = new TextEncoder().encode("deadbeef"); // tamper sig frame
    const err = assertThrows(
      () => decodeZmq(frames, KEY, SCHEME),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "ZMQ_SIGNATURE_MISMATCH");
  });

  it("rejects a one-byte content tamper under the same signature", () => {
    const frames = encodeZmq(makeMsg(), KEY, SCHEME);
    frames[5] = new TextEncoder().encode('{"code":"print(2)"}'); // content changed
    assertThrows(() => decodeZmq(frames, KEY, SCHEME), EuropaKernelError);
  });
});

/** @spec-id europa.kernel.wire-zmq.unsigned-empty-key */
describe("encode/decode — unsigned (empty key)", () => {
  it("emits an empty signature frame and skips verify", () => {
    const frames = encodeZmq(makeMsg(), "", SCHEME);
    assertEquals(frames[1].length, 0); // empty sig frame
    const decoded = decodeZmq(frames, "", SCHEME);
    assertEquals(decoded.header.msg_id, "m1");
  });
});

/** @spec-id europa.kernel.wire-zmq.binary-buffers */
describe("decodeZmq — binary buffers", () => {
  it("round-trips extra binary buffers as raw bytes", () => {
    const buf = new Uint8Array([1, 2, 3, 250]);
    const decoded = decodeZmq(
      encodeZmq(makeMsg({ buffers: [buf] }), KEY, SCHEME),
      KEY,
      SCHEME,
    );
    assertEquals(decoded.buffers.length, 1);
    assertEquals([...decoded.buffers[0]], [1, 2, 3, 250]);
  });

  it("interoperates with the mock codec byte-for-byte", () => {
    // real encode -> mock decode, and mock encode -> real decode.
    const realFrames = encodeZmq(makeMsg(), KEY, SCHEME);
    const viaMock = decodeZmqMock(realFrames, KEY, SCHEME);
    assertEquals(viaMock.header.msg_id, "m1");

    const mockFrames = encodeZmqMock(
      {
        header: makeMsg().header,
        parent_header: {},
        metadata: {},
        content: { code: "print(1)" },
        buffers: [],
      },
      KEY,
      SCHEME,
    );
    const viaReal = decodeZmq(mockFrames, KEY, SCHEME);
    assertEquals(viaReal.content, { code: "print(1)" });
  });
});
