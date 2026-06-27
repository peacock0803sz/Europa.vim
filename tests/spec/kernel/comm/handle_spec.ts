/**
 * BDD specs for CommHandle (Phase 5.1).
 *
 * @spec-id europa.kernel.comm.send-shell-msg
 * @spec-id europa.kernel.comm.send-shell-close
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { createCommHandle } from "../../../../denops/europa/kernel/comm/handle.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";

function recordingClient(): {
  client: KernelClient;
  calls: Array<{
    verb: "open" | "msg" | "close";
    content: Record<string, unknown>;
    buffers: Uint8Array[];
  }>;
  fail?: Error;
} {
  const ctx: {
    client: KernelClient;
    calls: Array<{
      verb: "open" | "msg" | "close";
      content: Record<string, unknown>;
      buffers: Uint8Array[];
    }>;
    fail?: Error;
  } = {
    client: null as unknown as KernelClient,
    calls: [],
  };
  const client = {
    start: () => Promise.reject(new Error("not in test")),
    shutdown: () => Promise.reject(new Error("not in test")),
    onMessage: () => () => {},
    execute: () => {
      throw new Error("not in test");
    },
    kernelInfo: () => Promise.reject(new Error("not in test")),
    interrupt: () => Promise.reject(new Error("not in test")),
    restart: () => Promise.reject(new Error("not in test")),
    sendComm: (
      verb: "open" | "msg" | "close",
      content: Record<string, unknown>,
      buffers?: Uint8Array[],
    ) => {
      ctx.calls.push({ verb, content, buffers: buffers ?? [] });
      if (ctx.fail) return Promise.reject(ctx.fail);
      return Promise.resolve();
    },
  } satisfies KernelClient;
  ctx.client = client;
  return ctx;
}

describe("CommHandle — send/close happy paths", () => {
  it("send routes to sendComm with verb='msg'", async () => {
    const ctx = recordingClient();
    let removed = false;
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {
        removed = true;
      },
    });
    await h.send({ payload: 1 }, [new Uint8Array([1, 2, 3])]);
    assertEquals(ctx.calls.length, 1);
    assertEquals(ctx.calls[0].verb, "msg");
    assertEquals(ctx.calls[0].content.comm_id, "c-1");
    assertEquals(removed, false);
  });

  it("close fires onClose subscribers and removes from the registry", async () => {
    const ctx = recordingClient();
    let removed = false;
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {
        removed = true;
      },
    });
    const seen: string[] = [];
    h.onClose((_d, _b, origin) => seen.push(origin));
    await h.close();
    assertEquals(removed, true);
    assertEquals(seen, ["kernel"]);
    assertEquals(h.isOpen(), false);
  });

  it("close is idempotent — a second close is a no-op", async () => {
    const ctx = recordingClient();
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {},
    });
    await h.close();
    await h.close();
    assertEquals(ctx.calls.length, 1);
  });
});

describe("CommHandle — closed-state errors", () => {
  it("send after close rejects with EuropaKernelError", async () => {
    const ctx = recordingClient();
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {},
    });
    await h.close();
    await assertRejects(
      () => h.send({}),
      EuropaKernelError,
    );
  });
});

describe("CommHandle — subscriber lifecycle", () => {
  it("_fireOnMessage drives onMessage subscribers", () => {
    const ctx = recordingClient();
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {},
    });
    const events: Record<string, unknown>[] = [];
    const unsub = h.onMessage((data) => events.push(data));
    h._fireOnMessage({ k: 1 }, []);
    h._fireOnMessage({ k: 2 }, []);
    assertEquals(events.length, 2);
    unsub();
    h._fireOnMessage({ k: 3 }, []);
    assertEquals(events.length, 2);
  });

  it("_fireOnClose with synthetic origin delivers to subscribers exactly once", () => {
    const ctx = recordingClient();
    let removed = false;
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {
        removed = true;
      },
    });
    const events: string[] = [];
    h.onClose((_d, _b, origin) => events.push(origin));
    h._fireOnClose({}, [], "frontend-shutdown");
    h._fireOnClose({}, [], "frontend-shutdown");
    assertEquals(events, ["frontend-shutdown"]);
    assertEquals(removed, true);
  });
});
