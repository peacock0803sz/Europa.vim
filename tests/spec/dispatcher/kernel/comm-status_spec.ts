/**
 * BDD specs for the commStatus dispatcher RPC.
 *
 * @spec-id europa.dispatcher.comm-status
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { buildKernelDispatcher } from "../../../../denops/europa/dispatcher/kernel.ts";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import type { DispatcherContext } from "../../../../denops/europa/dispatcher/context.ts";
import type { KernelClient } from "../../../../contracts/kernel-client.ts";
import type { CommHandle } from "../../../../contracts/comm-service.ts";

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

function makeCtx(
  sessions: Map<number, { kernelRuntime?: { commService?: unknown } }>,
): DispatcherContext {
  return {
    denops: { cmd: (_s: string) => Promise.resolve() } as never,
    sessionStore: {
      get: (bn: number) => sessions.get(bn) as never,
      update: () => {},
      setRenderPlan: () => {},
      getAllScratchBufnrs: () => [],
      all: () => Array.from(sessions.values()) as never,
    } as never,
    serverPool: {
      snapshot: () => [],
      killAll: () => Promise.resolve(),
    } as never,
  } as DispatcherContext;
}

describe("commStatus RPC — three-state return", () => {
  it("returns null when no kernel is attached", async () => {
    const ctx = makeCtx(new Map());
    const dispatch = buildKernelDispatcher(ctx);
    assertEquals(await dispatch.commStatus(0), null);
  });

  it("returns [] when a kernel is attached but no comms are open", async () => {
    const denops = {
      cmd: (_s: string) => Promise.resolve(),
    } as never;
    const svc = createCommService(silentClient(), denops);
    const sessions = new Map([
      [3, { kernelRuntime: { commService: svc } }],
    ]);
    const ctx = makeCtx(sessions);
    const dispatch = buildKernelDispatcher(ctx);
    assertEquals(await dispatch.commStatus(3), []);
  });

  it("returns one report per open comm, sorted by openedAt", async () => {
    const denops = {
      cmd: (_s: string) => Promise.resolve(),
    } as never;
    const svc = createCommService(silentClient(), denops);
    const a = await svc.openComm({ targetName: "europa.test.echo" });
    const b = await svc.openComm({ targetName: "jupyter.widget" });
    const sessions = new Map([
      [3, { kernelRuntime: { commService: svc } }],
    ]);
    const ctx = makeCtx(sessions);
    const dispatch = buildKernelDispatcher(ctx);
    const reports = await dispatch.commStatus(3);
    assertEquals(reports?.length, 2);
    assertEquals(reports?.[0].commId, (a as CommHandle).commId);
    assertEquals(reports?.[1].commId, (b as CommHandle).commId);
    assertEquals(reports?.[0].opener, "frontend");
  });

  it("rejects with INVALID_ARGS for a negative bufnr", async () => {
    const ctx = makeCtx(new Map());
    const dispatch = buildKernelDispatcher(ctx);
    const err = await assertRejects(
      () => dispatch.commStatus(-1),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "INVALID_ARGS");
  });
});
