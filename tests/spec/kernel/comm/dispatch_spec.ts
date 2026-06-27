/**
 * BDD specs for CommDispatcher (Phase 5.1).
 *
 * @spec-id europa.kernel.comm.dispatch-open-accept
 * @spec-id europa.kernel.comm.dispatch-open-reject-duplicate
 * @spec-id europa.kernel.comm.dispatch-msg
 * @spec-id europa.kernel.comm.dispatch-close
 * @spec-id europa.kernel.comm.grace-queue-buffer
 * @spec-id europa.kernel.comm.grace-queue-flush
 * @spec-id europa.kernel.comm.grace-queue-timeout
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import type { Denops } from "@denops/std";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import type { CommTargetHandler } from "../../../../contracts/comm-service.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import type { Header, KernelMessage } from "../../../../schema/message.ts";

function denopsStub(): Denops {
  return { cmd: (_s: string) => Promise.resolve() } as unknown as Denops;
}

interface MockClient {
  client: KernelClient;
  calls: Array<{
    verb: "open" | "msg" | "close";
    content: Record<string, unknown>;
    parentHeader?: Header;
  }>;
}

function mockClient(): MockClient {
  const m: MockClient = { client: null as unknown as KernelClient, calls: [] };
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
      _buffers?: Uint8Array[],
      parentHeader?: Header,
    ) => {
      m.calls.push({ verb, content, parentHeader });
      return Promise.resolve();
    },
  } satisfies KernelClient;
  m.client = client;
  return m;
}

function makeMsg(
  msgType: "comm_open" | "comm_msg" | "comm_close",
  content: Record<string, unknown>,
  buffers: Uint8Array[] = [],
): KernelMessage {
  return {
    header: {
      msg_id: crypto.randomUUID(),
      msg_type: msgType,
      username: "test",
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

describe("CommDispatcher — comm_open accept", () => {
  it("invokes the registered handler and inserts an entry", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    let invoked = false;
    const h: CommTargetHandler = ({ handle }) => {
      invoked = true;
      return handle;
    };
    svc.registerHandler("europa.test.echo", h);
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-1",
      target_name: "europa.test.echo",
      data: {},
    }));
    assertEquals(invoked, true);
    assertEquals(svc.list().length, 1);
  });
});

describe("CommDispatcher — comm_open reject (duplicate)", () => {
  it("sends a comm_close with the original comm_open header as parent", async () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    svc.registerHandler("europa.test.echo", ({ handle }) => handle);
    const open1 = makeMsg("comm_open", {
      comm_id: "c-dup",
      target_name: "europa.test.echo",
      data: {},
    });
    svc.handleInbound(open1);
    await Promise.resolve();
    const open2 = makeMsg("comm_open", {
      comm_id: "c-dup",
      target_name: "europa.test.echo",
      data: {},
    });
    svc.handleInbound(open2);
    await Promise.resolve();
    const closeCall = m.calls.find((c) => c.verb === "close");
    assertEquals(closeCall?.parentHeader?.msg_id, open2.header.msg_id);
  });
});

describe("CommDispatcher — comm_msg / comm_close routing", () => {
  it("delivers comm_msg payload to the handle's onMessage subscribers", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    let received: Record<string, unknown> | null = null;
    svc.registerHandler("europa.test.echo", ({ handle }) => {
      handle.onMessage((data) => {
        received = data;
      });
      return handle;
    });
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-1",
      target_name: "europa.test.echo",
      data: {},
    }));
    svc.handleInbound(makeMsg("comm_msg", {
      comm_id: "c-1",
      data: { value: 42 },
    }));
    assertEquals(received, { value: 42 });
  });

  it("comm_close removes the entry from the registry", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    svc.registerHandler("europa.test.echo", ({ handle }) => handle);
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-1",
      target_name: "europa.test.echo",
      data: {},
    }));
    svc.handleInbound(makeMsg("comm_close", { comm_id: "c-1", data: {} }));
    assertEquals(svc.list().length, 0);
  });
});

describe("CommDispatcher — grace queue", () => {
  let time: FakeTime;
  beforeEach(() => {
    time = new FakeTime();
  });
  afterEach(() => {
    time.restore();
  });

  it("buffers a pre-open comm_msg and flushes it once comm_open arrives", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    let flushed: Record<string, unknown> | null = null;
    svc.registerHandler("europa.test.echo", ({ handle }) => {
      handle.onMessage((data) => {
        flushed = data;
      });
      return handle;
    });
    svc.handleInbound(makeMsg("comm_msg", {
      comm_id: "c-race",
      data: { early: true },
    }));
    time.tick(50);
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-race",
      target_name: "europa.test.echo",
      data: {},
    }));
    assertEquals(flushed, { early: true });
  });

  it("drops pre-open msgs that miss the 200 ms window", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    let flushed: Record<string, unknown> | null = null;
    svc.registerHandler("europa.test.echo", ({ handle }) => {
      handle.onMessage((data) => {
        flushed = data;
      });
      return handle;
    });
    svc.handleInbound(makeMsg("comm_msg", {
      comm_id: "c-late",
      data: { late: true },
    }));
    time.tick(300);
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-late",
      target_name: "europa.test.echo",
      data: {},
    }));
    assertEquals(flushed, null);
  });
});
