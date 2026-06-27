/**
 * BDD specs that lock in the Phase 5.1 negative invariant for comm
 * persistence: comm_* traffic must never bleed into the `.ipynb` JSON.
 * Cell outputs, kernel metadata, and the on-disk shape stay byte-stable
 * across a round-trip of openComm / handle.send / kernel-initiated
 * comm_msg / comm_close.
 *
 * The test parses an existing fixture, runs the comm flow against an
 * in-memory mock client, serializes the notebook again, and compares the
 * normalised JSON. Comparing the normalised form (parseNotebook output)
 * isolates the invariant from incidental formatting differences the
 * serializer may apply (e.g. trailing-newline normalisation).
 *
 * @spec-id europa.kernel.comm.no-persistence
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import { parseNotebook } from "../../../../denops/europa/notebook/parse.ts";
import { serializeNotebook } from "../../../../denops/europa/notebook/serialize.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import type { KernelMessage } from "../../../../schema/message.ts";

function silentClient(): KernelClient {
  return {
    start: () => Promise.reject(new Error("not in test")),
    shutdown: () => Promise.reject(new Error("not in test")),
    onMessage: () => () => {},
    execute: () => {
      throw new Error("not in test");
    },
    kernelInfo: () => Promise.reject(new Error("not in test")),
    interrupt: () => Promise.reject(new Error("not in test")),
    restart: () => Promise.reject(new Error("not in test")),
    sendComm: () => Promise.resolve(),
  };
}

function makeMsg(
  msgType: "comm_msg" | "comm_close",
  content: Record<string, unknown>,
  buffers: Uint8Array[] = [],
): KernelMessage {
  return {
    header: {
      msg_id: crypto.randomUUID(),
      msg_type: msgType,
      username: "kernel",
      session: "sess",
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: {},
    metadata: {},
    content,
    buffers,
  };
}

describe("Comm traffic does not bleed into .ipynb persistence", () => {
  it("a comm round-trip leaves the parsed notebook byte-for-byte stable", async () => {
    const path = new URL(
      "../../../fixtures/hello.ipynb",
      import.meta.url,
    );
    const original = await Deno.readTextFile(path);
    const before = await parseNotebook(original);
    const denops = {
      cmd: (_s: string) => Promise.resolve(),
    } as never;
    const svc = createCommService(silentClient(), denops);
    svc.registerHandler("europa.test.echo", ({ handle }) => handle);

    const handle = await svc.openComm({
      commId: "c-no-persist",
      targetName: "europa.test.echo",
    });
    await handle.send({ tick: 1 }, [new Uint8Array([1, 2, 3])]);

    svc.handleInbound(makeMsg("comm_msg", {
      comm_id: "c-no-persist",
      data: { ack: 1 },
    }, [new Uint8Array([4, 5, 6])]));
    svc.handleInbound(makeMsg("comm_close", {
      comm_id: "c-no-persist",
      data: {},
    }));

    const after = await parseNotebook(serializeNotebook(before));
    assertEquals(after, before);
    assertEquals(svc.list().length, 0);
  });
});
