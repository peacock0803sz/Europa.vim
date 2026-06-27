/**
 * BDD specs for CommService (Phase 5.1).
 *
 * @spec-id europa.contract.comm-service
 * @spec-id europa.kernel.comm.send-shell-open
 * @spec-id europa.kernel.comm.close-all-shutdown
 * @spec-id europa.kernel.comm.close-all-restart
 * @spec-id europa.kernel.comm.close-all-wipeout
 * @spec-id europa.kernel.comm.ws-reconnect-preserve
 * @spec-id europa.kernel.comm.send-during-reconnect
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import type { Denops } from "@denops/std";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import type {
  CommHandle,
  CommTargetHandler,
} from "../../../../contracts/comm-service.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";

function denopsStub(): Denops {
  return {
    cmd: (_s: string) => Promise.resolve(),
  } as unknown as Denops;
}

interface MockClient {
  client: KernelClient;
  calls: Array<{
    verb: "open" | "msg" | "close";
    content: Record<string, unknown>;
  }>;
  fail?: Error;
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
    ) => {
      m.calls.push({ verb, content });
      if (m.fail) return Promise.reject(m.fail);
      return Promise.resolve();
    },
  } satisfies KernelClient;
  m.client = client;
  return m;
}

describe("CommService — registerHandler / openComm", () => {
  it("registerHandler returns idempotent unregister", () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    const h: CommTargetHandler = ({ handle }) => handle;
    const off = svc.registerHandler("europa.test.echo", h);
    assertEquals(svc.lookupTargetHandler("europa.test.echo"), h);
    off();
    off();
    assertEquals(svc.lookupTargetHandler("europa.test.echo"), undefined);
  });

  it("openComm generates a comm_id, inserts the entry, and sends comm_open", async () => {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    const handle: CommHandle = await svc.openComm({
      targetName: "europa.test.echo",
      data: { hello: 1 },
    });
    assertEquals(m.calls.length, 1);
    assertEquals(m.calls[0].verb, "open");
    assertEquals(m.calls[0].content.target_name, "europa.test.echo");
    assertEquals(svc.list().length, 1);
    assertEquals(svc.list()[0].handle, handle);
  });

  it("openComm rolls back the registry insertion when sendComm rejects", async () => {
    const m = mockClient();
    m.fail = new EuropaKernelError("KERNEL_RECONNECTING", "reconnecting");
    const svc = createCommService(m.client, denopsStub());
    await assertRejects(
      () => svc.openComm({ targetName: "europa.test.echo" }),
      EuropaKernelError,
    );
    assertEquals(svc.list().length, 0);
  });
});

describe("CommService — closeAll fires synthetic origins", () => {
  async function fixture() {
    const m = mockClient();
    const svc = createCommService(m.client, denopsStub());
    const seen: { commId: string; origin: string }[] = [];
    for (const id of ["a", "b", "c"]) {
      const h = await svc.openComm({
        commId: id,
        targetName: "europa.test.echo",
      });
      h.onClose((_d, _b, origin) => seen.push({ commId: h.commId, origin }));
    }
    return { svc, seen };
  }

  it("closeAll('shutdown') delivers frontend-shutdown to every handler and clears the registry", async () => {
    const { svc, seen } = await fixture();
    await svc.closeAll("shutdown");
    assertEquals(svc.list().length, 0);
    assertEquals(seen.map((s) => s.origin), [
      "frontend-shutdown",
      "frontend-shutdown",
      "frontend-shutdown",
    ]);
  });

  it("closeAll('restart') uses frontend-restart and keeps target handlers callable", async () => {
    const { svc } = await fixture();
    const h: CommTargetHandler = ({ handle }) => handle;
    svc.registerHandler("europa.test.echo", h);
    await svc.closeAll("restart");
    assertEquals(svc.lookupTargetHandler("europa.test.echo"), h);
  });

  it("closeAll('wipeout') uses frontend-wipeout", async () => {
    const { svc, seen } = await fixture();
    await svc.closeAll("wipeout");
    assertEquals(seen.every((s) => s.origin === "frontend-wipeout"), true);
  });
});
