/**
 * BDD specs for Jupyter wire protocol v1 (binary offset-table format).
 *
 * @spec-id europa.kernel.wire-v1.encode
 * @spec-id europa.kernel.wire-v1.decode
 * @spec-id europa.kernel.wire-v1.roundtrip
 * @spec-id europa.kernel.wire-v1.binary-buffers
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater, assertInstanceOf } from "@std/assert";
import {
  decodeV1,
  encodeV1,
} from "../../../../denops/europa/kernel/wire/protocol-v1.ts";
import type { KernelMessage } from "../../../../schema/message.ts";

// Minimal KernelMessage factories for tests
function makeMsg(
  msgType: string,
  content: Record<string, unknown> = {},
  buffers: Uint8Array[] = [],
): KernelMessage {
  return {
    header: {
      msg_id: crypto.randomUUID(),
      msg_type: msgType,
      username: "test",
      session: "test-session",
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: {},
    metadata: {},
    content,
    buffers,
  };
}

describe("encodeV1 — kernel_info_request (no buffers)", () => {
  it("produces a Uint8Array", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    assertInstanceOf(buf, Uint8Array);
  });

  it("offset_count == 6 when buffers is empty", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const offsetCount = view.getUint32(0, true); // LE
    assertEquals(offsetCount, 6);
  });

  it("offset_count is encoded as uint32 little-endian", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    // Little-endian: byte 0 is least significant
    assertEquals(buf[0], 6);
    assertEquals(buf[1], 0);
    assertEquals(buf[2], 0);
    assertEquals(buf[3], 0);
  });

  it("last offset equals total buffer length (sentinel)", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const offsetCount = view.getUint32(0, true);
    const lastOffset = view.getUint32(offsetCount * 4, true);
    assertEquals(lastOffset, buf.byteLength);
  });
});

describe("decodeV1 — kernel_info_request round-trip", () => {
  it("round-trips msg_type", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.header.msg_type, "kernel_info_request");
  });

  it("round-trips full header", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.header.msg_id, msg.header.msg_id);
    assertEquals(decoded.header.username, msg.header.username);
    assertEquals(decoded.header.session, msg.header.session);
  });

  it("round-trips content", () => {
    const msg = makeMsg("execute_input", { code: "x = 1", execution_count: 1 });
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.content["code"], "x = 1");
    assertEquals(decoded.content["execution_count"], 1);
  });

  it("round-trips metadata", () => {
    const msg = makeMsg("status");
    (msg.metadata as Record<string, unknown>)["key"] = "value";
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.metadata["key"], "value");
  });

  it("parent_header preserved as empty object when not set", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(typeof decoded.parent_header, "object");
  });
});

describe("decodeV1 — kernel_info_reply", () => {
  it("round-trips status field in content", () => {
    const content = {
      status: "ok",
      protocol_version: "5.3",
      implementation: "ipython",
      implementation_version: "8.0.0",
      language_info: { name: "python", version: "3.12.0" },
      banner: "IPython",
      help_links: [],
    };
    const msg = makeMsg("kernel_info_reply", content);
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.content["status"], "ok");
    assertEquals(decoded.content["protocol_version"], "5.3");
    assertEquals(decoded.content["implementation"], "ipython");
  });
});

describe("encodeV1/decodeV1 — binary buffers", () => {
  it("offset_count == 7 when 1 buffer is present", () => {
    const bin = new Uint8Array([1, 2, 3]);
    const msg = makeMsg("stream", {}, [bin]);
    const buf = encodeV1(msg);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    assertEquals(view.getUint32(0, true), 7); // 6 + 1 buffer
  });

  it("round-trips a single binary buffer byte-identical", () => {
    const bin = new Uint8Array([10, 20, 30, 40, 50]);
    const msg = makeMsg("display_data", {}, [bin]);
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.buffers.length, 1);
    assertEquals(decoded.buffers[0], bin);
  });

  it("round-trips multiple binary buffers byte-identical", () => {
    const a = new Uint8Array([0xff, 0x00]);
    const b = new Uint8Array([0x01, 0x02, 0x03]);
    const msg = makeMsg("display_data", {}, [a, b]);
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.buffers.length, 2);
    assertEquals(decoded.buffers[0], a);
    assertEquals(decoded.buffers[1], b);
  });

  it("offset_count == 6 + buffers.length for N buffers", () => {
    for (let n = 0; n <= 5; n++) {
      const buffers = Array.from(
        { length: n },
        (_, i) => new Uint8Array([i, i + 1]),
      );
      const msg = makeMsg("execute_result", {}, buffers);
      const buf = encodeV1(msg);
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      assertEquals(view.getUint32(0, true), 6 + n, `n=${n}`);
    }
  });
});

describe("encodeV1/decodeV1 — additional msg types", () => {
  it("round-trips status msg", () => {
    const msg = makeMsg("status", { execution_state: "idle" });
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.header.msg_type, "status");
    assertEquals(decoded.content["execution_state"], "idle");
  });

  it("round-trips stream msg", () => {
    const msg = makeMsg("stream", { name: "stdout", text: "hello\n" });
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.content["name"], "stdout");
    assertEquals(decoded.content["text"], "hello\n");
  });

  it("round-trips execute_result msg", () => {
    const msg = makeMsg("execute_result", {
      execution_count: 42,
      data: { "text/plain": "42" },
      metadata: {},
    });
    const decoded = decodeV1(encodeV1(msg));
    assertEquals(decoded.content["execution_count"], 42);
  });
});

describe("encodeV1/decodeV1 — property test: 1000 messages × 5 types", () => {
  const MSG_TYPES = [
    "kernel_info_request",
    "kernel_info_reply",
    "status",
    "stream",
    "execute_result",
  ];

  it("round-trip 100% success across 1000 messages × 5 types (SC-007)", () => {
    for (let i = 0; i < 1000; i++) {
      for (const msgType of MSG_TYPES) {
        const msg = makeMsg(msgType, { idx: i }, []);
        const decoded = decodeV1(encodeV1(msg));
        assertEquals(
          decoded.header.msg_type,
          msgType,
          `Failed at i=${i} msgType=${msgType}`,
        );
        assertEquals(decoded.header.msg_id, msg.header.msg_id);
        assertEquals(decoded.content["idx"], i);
      }
    }
  });
});

describe("encodeV1 — endianness verification", () => {
  it("offset_count field is uint32 little-endian (6 = 0x06 0x00 0x00 0x00)", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    assertEquals(buf[0], 0x06); // LSB
    assertEquals(buf[1], 0x00);
    assertEquals(buf[2], 0x00);
    assertEquals(buf[3], 0x00); // MSB
  });

  it("offsets are uint32 little-endian (byte order verification)", () => {
    const msg = makeMsg("kernel_info_request");
    const buf = encodeV1(msg);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const offsetCount = view.getUint32(0, true);
    // Verify all offsets are monotonically non-decreasing (basic sanity)
    let prev = 0;
    for (let i = 0; i < offsetCount; i++) {
      const off = view.getUint32((i + 1) * 4, true);
      assertGreater(off, prev - 1, `offset[${i}]=${off} < prev=${prev}`);
      prev = off;
    }
  });
});
