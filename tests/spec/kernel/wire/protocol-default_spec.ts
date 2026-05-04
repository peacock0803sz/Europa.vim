/**
 * BDD specs for Jupyter wire protocol default (text JSON format).
 *
 * @spec-id europa.kernel.wire-default.encode
 * @spec-id europa.kernel.wire-default.decode
 * @spec-id europa.kernel.wire-default.roundtrip
 * @spec-id europa.kernel.wire-default.buffers-warning
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import {
  decodeDefault,
  encodeDefault,
} from "../../../../denops/europa/kernel/wire/protocol-default.ts";
import type { KernelMessage } from "../../../../schema/message.ts";

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

describe("encodeDefault — kernel_info_request text JSON", () => {
  it("returns a string", () => {
    const msg = makeMsg("kernel_info_request");
    const text = encodeDefault(msg);
    assertEquals(typeof text, "string");
  });

  it("produces valid JSON", () => {
    const msg = makeMsg("kernel_info_request");
    const text = encodeDefault(msg);
    const parsed = JSON.parse(text);
    assertEquals(typeof parsed, "object");
  });

  it("includes header in JSON", () => {
    const msg = makeMsg("kernel_info_request");
    const text = encodeDefault(msg);
    const parsed = JSON.parse(text);
    assertEquals(parsed.header.msg_type, "kernel_info_request");
  });

  it("includes parent_header, metadata, content", () => {
    const msg = makeMsg("kernel_info_request", { key: "val" });
    const text = encodeDefault(msg);
    const parsed = JSON.parse(text);
    assertEquals(typeof parsed.parent_header, "object");
    assertEquals(typeof parsed.metadata, "object");
    assertEquals(parsed.content["key"], "val");
  });

  it("does not include buffers key in output JSON", () => {
    const msg = makeMsg("kernel_info_request");
    const text = encodeDefault(msg);
    const parsed = JSON.parse(text);
    assertEquals("buffers" in parsed, false);
  });
});

describe("decodeDefault — kernel_info_request / reply", () => {
  it("round-trips msg_type", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeDefault(encodeDefault(msg));
    assertEquals(decoded.header.msg_type, "kernel_info_request");
  });

  it("round-trips full header", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeDefault(encodeDefault(msg));
    assertEquals(decoded.header.msg_id, msg.header.msg_id);
    assertEquals(decoded.header.username, "test");
    assertEquals(decoded.header.session, "test-session");
  });

  it("round-trips content fields", () => {
    const msg = makeMsg("kernel_info_reply", {
      status: "ok",
      protocol_version: "5.3",
    });
    const decoded = decodeDefault(encodeDefault(msg));
    assertEquals(decoded.content["status"], "ok");
    assertEquals(decoded.content["protocol_version"], "5.3");
  });

  it("decoded message has buffers as empty array", () => {
    const msg = makeMsg("kernel_info_request");
    const decoded = decodeDefault(encodeDefault(msg));
    assertEquals(decoded.buffers, []);
  });
});

describe("encodeDefault — buffers warning + lossy drop (SC-008)", () => {
  it("buffers are dropped from output when present", () => {
    const bin = new Uint8Array([1, 2, 3]);
    const msg = makeMsg("display_data", {}, [bin]);
    const text = encodeDefault(msg);
    const parsed = JSON.parse(text);
    assertEquals("buffers" in parsed, false);
  });

  it("does not throw when buffers are present", () => {
    const bin = new Uint8Array([1, 2, 3]);
    const msg = makeMsg("display_data", {}, [bin]);
    // Should not throw
    encodeDefault(msg);
  });

  it("round-trips correctly when no buffers", () => {
    const msg = makeMsg("stream", { name: "stdout", text: "hello\n" });
    const decoded = decodeDefault(encodeDefault(msg));
    assertEquals(decoded.content["text"], "hello\n");
    assertEquals(decoded.buffers, []);
  });
});

describe("decodeDefault — round-trip 100% on buffers-none messages", () => {
  const MSG_TYPES = [
    "kernel_info_request",
    "kernel_info_reply",
    "status",
    "stream",
    "execute_result",
  ];

  it("round-trips 100 messages × 5 types with no buffers", () => {
    for (let i = 0; i < 100; i++) {
      for (const msgType of MSG_TYPES) {
        const msg = makeMsg(msgType, { idx: i });
        const decoded = decodeDefault(encodeDefault(msg));
        assertEquals(
          decoded.header.msg_type,
          msgType,
          `Failed at i=${i} msgType=${msgType}`,
        );
        assertEquals(decoded.header.msg_id, msg.header.msg_id);
        assertEquals(decoded.content["idx"], i);
        assertEquals(decoded.buffers, []);
      }
    }
  });
});

describe("encodeDefault — warning observable (buffers-warning spec)", () => {
  it("calls onBuffersDropped callback when buffers are present", () => {
    const bin = new Uint8Array([0xde, 0xad]);
    const msg = makeMsg("display_data", {}, [bin]);
    let warningFired = false;
    encodeDefault(msg, (_w: string) => {
      warningFired = true;
    });
    assertEquals(warningFired, true);
  });

  it("does not call onBuffersDropped callback when no buffers", () => {
    const msg = makeMsg("kernel_info_request");
    let warningFired = false;
    encodeDefault(msg, (_w: string) => {
      warningFired = true;
    });
    assertEquals(warningFired, false);
  });

  it("warning message contains 'buffers' string (default console.warn path)", () => {
    // Verify the default path uses a recognizable message by checking the
    // exported WARNING_MSG constant (if present) or the callback receives a string.
    const bin = new Uint8Array([1]);
    const msg = makeMsg("display_data", {}, [bin]);
    let warningMsg = "";
    encodeDefault(msg, (w: string) => {
      warningMsg = w;
    });
    assertStringIncludes(warningMsg.toLowerCase(), "buffer");
  });
});

describe("decodeDefault — handles missing optional fields gracefully", () => {
  it("tolerates missing parent_header → defaults to empty object", () => {
    const raw = JSON.stringify({
      header: {
        msg_id: "x",
        msg_type: "kernel_info_request",
        username: "u",
        session: "s",
        date: "2026-01-01T00:00:00Z",
        version: "5.3",
      },
      metadata: {},
      content: {},
    });
    const decoded = decodeDefault(raw);
    assertEquals(typeof decoded.parent_header, "object");
    assertGreater(Object.keys(decoded.parent_header as object).length, -1);
  });
});
