/**
 * BDD specs that lock in the Phase 5.1 negative invariant for `comm_info_*`:
 * the dispatcher must not handle these message types, so the registry stays
 * unchanged and the grace queue stays empty. This guards against an
 * accidental upgrade that would land enumeration work belonging to Phase 5
 * item 2 inside the transport slice.
 *
 * @spec-id europa.kernel.comm.comm-info-bypass
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import type { KernelMessage } from "../../../../schema/message.ts";

function silentClient(calls: Array<unknown>): KernelClient {
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
    sendComm: (...args) => {
      calls.push(args);
      return Promise.resolve();
    },
  };
}

function denopsStub() {
  return {
    cmd: (_s: string) => Promise.resolve(),
  } as never;
}

function makeMsg(
  msgType: string,
  content: Record<string, unknown>,
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
    buffers: [],
  };
}

describe("CommDispatcher — comm_info_* pass-through", () => {
  it("comm_info_request must not mutate the registry or send a reply", () => {
    const calls: unknown[] = [];
    const svc = createCommService(silentClient(calls), denopsStub());
    svc.handleInbound(makeMsg("comm_info_request", { target_name: "any" }));
    assertEquals(svc.list().length, 0);
    assertEquals(calls.length, 0);
  });

  it("comm_info_reply must not mutate the registry or fire subscribers", () => {
    const calls: unknown[] = [];
    const svc = createCommService(silentClient(calls), denopsStub());
    svc.handleInbound(makeMsg("comm_info_reply", { comms: {} }));
    assertEquals(svc.list().length, 0);
    assertEquals(calls.length, 0);
  });

  it("does not interfere with subsequent legitimate comm_open / comm_msg", () => {
    const calls: unknown[] = [];
    const svc = createCommService(silentClient(calls), denopsStub());
    svc.registerHandler("europa.test.echo", ({ handle }) => handle);
    svc.handleInbound(makeMsg("comm_info_request", {}));
    svc.handleInbound(makeMsg("comm_open", {
      comm_id: "c-1",
      target_name: "europa.test.echo",
      data: {},
    }));
    assertEquals(svc.list().length, 1);
  });
});
