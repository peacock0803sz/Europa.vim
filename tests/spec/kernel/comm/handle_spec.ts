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

  it("close fires onClose subscribers with frontend-explicit origin and removes from the registry", async () => {
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
    assertEquals(seen, ["frontend-explicit"]);
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

  it("close rolls back isOpen and skips subscribers when sendComm rejects", async () => {
    const ctx = recordingClient();
    ctx.fail = new EuropaKernelError("KERNEL_RECONNECTING", "reconnecting");
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
    await assertRejects(
      () => h.close(),
      EuropaKernelError,
    );
    assertEquals(h.isOpen(), true, "isOpen must be restored after rollback");
    assertEquals(seen, [], "onClose must not fire when sendComm rejects");
    assertEquals(removed, false, "registry must not be removed on rejection");

    ctx.fail = undefined;
    await h.close();
    assertEquals(h.isOpen(), false);
    assertEquals(seen, ["frontend-explicit"]);
    assertEquals(removed, true);
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

describe("CommHandle — close() race with kernel-initiated _fireOnClose", () => {
  function makeDeferredSendCloseClient(): {
    client: KernelClient;
    resolveClose: () => void;
    rejectClose: (e: Error) => void;
    msgCalls: number;
  } {
    const state = {
      resolve: null as null | (() => void),
      reject: null as null | ((e: Error) => void),
      msgCalls: 0,
    };
    const sendComm = ((
      verb: "open" | "msg" | "close",
      _content: Record<string, unknown>,
      _buffers?: Uint8Array[],
    ) => {
      if (verb === "close") {
        return new Promise<void>((res, rej) => {
          state.resolve = res;
          state.reject = rej;
        });
      }
      state.msgCalls++;
      return Promise.resolve();
    }) as KernelClient["sendComm"];
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
      sendComm,
    } satisfies KernelClient;
    return {
      client,
      resolveClose: () => state.resolve?.(),
      rejectClose: (e) => state.reject?.(e),
      get msgCalls() {
        return state.msgCalls;
      },
    };
  }

  it("kernel-initiated _fireOnClose during await(sendComm) wins; close() resolves with no double-fire", async () => {
    const ctx = makeDeferredSendCloseClient();
    let removed = 0;
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {
        removed++;
      },
    });
    const events: string[] = [];
    h.onClose((_d, _b, origin) => events.push(origin));

    const closePromise = h.close();
    // Yield once so close() advances into the await(sendComm) suspension.
    await Promise.resolve();

    // Kernel-initiated comm_close arrives mid-await.
    h._fireOnClose({}, [], "kernel");
    assertEquals(events, ["kernel"], "kernel close must fire subscribers");
    assertEquals(h.isOpen(), false);
    assertEquals(removed, 1, "registry removal must run when kernel wins");

    // Resolve the awaiting sendComm. close() resumes on the success branch
    // but must detect state==="closed" and skip subscriber re-fire.
    ctx.resolveClose();
    await closePromise;

    assertEquals(
      events,
      ["kernel"],
      "close() success branch must not double-fire subscribers",
    );
    assertEquals(
      removed,
      1,
      "close() success branch must not double-remove from registry",
    );
    assertEquals(h.isOpen(), false);
  });

  it("kernel-initiated _fireOnClose during await(sendComm) survives sendComm rejection without restore", async () => {
    const ctx = makeDeferredSendCloseClient();
    const h = createCommHandle({
      commId: "c-1",
      targetName: "europa.test.echo",
      client: ctx.client,
      onCloseRegistryRemove: () => {},
    });
    const events: string[] = [];
    h.onClose((_d, _b, origin) => events.push(origin));

    const closePromise = h.close();
    await Promise.resolve();
    h._fireOnClose({}, [], "kernel");

    // Reject the awaiting sendComm. close() resumes on the catch branch but
    // must NOT restore state to "open" because the kernel already closed
    // the comm — otherwise isOpen() would lie about a comm the kernel
    // forgot about (the docstring's "no half-open state" invariant).
    ctx.rejectClose(
      new EuropaKernelError("KERNEL_RECONNECTING", "reconnecting"),
    );
    await assertRejects(() => closePromise, EuropaKernelError);

    assertEquals(events, ["kernel"]);
    assertEquals(
      h.isOpen(),
      false,
      "must NOT restore to open when kernel already closed the comm",
    );
  });
});
