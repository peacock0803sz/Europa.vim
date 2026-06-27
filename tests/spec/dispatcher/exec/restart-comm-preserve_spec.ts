/**
 * BDD spec for the dispatcher's `restartKernel` preserving Comm state
 * when the REST restart leg fails. Pairs with the dispatcher impl in
 * `denops/europa/dispatcher/exec/restart.ts`.
 *
 * @spec-id europa.dispatcher.restart-comm-preserve-on-fail
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildRestartDispatcher } from "../../../../denops/europa/dispatcher/exec/restart.ts";
import { createCommService } from "../../../../denops/europa/kernel/comm/service.ts";
import { EuropaKernelError } from "../../../../denops/europa/kernel/errors.ts";
import type { DispatcherContext } from "../../../../denops/europa/dispatcher/context.ts";
import type { CommService } from "../../../../contracts/comm-service.ts";
import type {
  KernelClient,
  KernelRuntime,
} from "../../../../contracts/kernel-client.ts";

function silentClient(restartImpl: () => Promise<void>): KernelClient {
  return {
    start: () => Promise.reject(new Error("not in test")),
    shutdown: () => Promise.resolve(),
    onMessage: () => () => {},
    execute: () => {
      throw new Error("not in test");
    },
    kernelInfo: () => Promise.reject(new Error("not in test")),
    interrupt: () => Promise.reject(new Error("not in test")),
    restart: restartImpl,
    sendComm: () => Promise.resolve(),
  };
}

function makeKernelRuntime(
  client: KernelClient,
  commService: CommService,
): KernelRuntime {
  return {
    client,
    serverKey: "test",
    info: {
      kernelId: "k-1",
      sessionId: "s-1",
      kernelName: "python3",
      connectionMode: "server",
      state: "idle",
      subprotocol: "v1",
      startedAt: new Date(0).toISOString(),
      banner: "test",
    },
    socket: { readyState: 1 } as WebSocket,
    abort: new AbortController(),
    pendingRequests: new Map(),
    execState: "idle",
    cellStates: new Map(),
    commService,
    cwd: "/",
  };
}

function makeCtx(
  sessions: Map<number, { kernelRuntime?: KernelRuntime; notebook?: unknown }>,
  cmdSink: string[] = [],
): DispatcherContext {
  return {
    denops: {
      cmd: (s: string) => {
        cmdSink.push(s);
        return Promise.resolve();
      },
    } as never,
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

describe("restartKernel — preserves Comm state on RESTART_REST_FAILED, wipes on RESTART_HANDSHAKE_FAILED", () => {
  it("does NOT clear the CommRegistry when client.restart() rejects with RESTART_REST_FAILED", async () => {
    const denops = {
      cmd: (_s: string) => Promise.resolve(),
    } as never;
    const commService = createCommService(
      silentClient(() =>
        Promise.reject(
          new EuropaKernelError(
            "RESTART_REST_FAILED",
            "restart REST failed: 500",
          ),
        )
      ),
      denops,
    );
    await commService.openComm({
      commId: "c-keep",
      targetName: "europa.test.echo",
    });

    const client = silentClient(() =>
      Promise.reject(
        new EuropaKernelError(
          "RESTART_REST_FAILED",
          "restart REST failed: 500",
        ),
      )
    );
    const runtime = makeKernelRuntime(client, commService);
    const sessions = new Map([
      [
        7,
        {
          kernelRuntime: runtime,
          notebook: { cells: [] },
        },
      ],
    ]);
    const cmdSink: string[] = [];
    const ctx = makeCtx(sessions, cmdSink);

    const dispatcher = buildRestartDispatcher(ctx);
    await dispatcher.restartKernel(7);

    assertEquals(
      commService.list().length,
      1,
      "the open comm must survive a failed restart because the kernel-side comm is still alive",
    );
    assertEquals(
      commService.list()[0].commId,
      "c-keep",
      "the same commId must remain in the registry",
    );
    assertEquals(
      runtime.execState,
      "idle",
      "execState must be restored to idle on restart failure",
    );
    assertEquals(
      cmdSink.some((s) => s.includes("Kernel restart failed")),
      true,
      "user-visible failure message must be emitted",
    );
  });

  it("DOES clear the CommRegistry when client.restart() rejects with RESTART_HANDSHAKE_FAILED", async () => {
    const denops = {
      cmd: (_s: string) => Promise.resolve(),
    } as never;
    const commService = createCommService(
      silentClient(() =>
        Promise.reject(
          new EuropaKernelError(
            "RESTART_HANDSHAKE_FAILED",
            "restart handshake timed out after WebSocket reconnect",
          ),
        )
      ),
      denops,
    );
    await commService.openComm({
      commId: "c-wipe",
      targetName: "europa.test.echo",
    });

    const client = silentClient(() =>
      Promise.reject(
        new EuropaKernelError(
          "RESTART_HANDSHAKE_FAILED",
          "restart handshake timed out after WebSocket reconnect",
        ),
      )
    );
    const runtime = makeKernelRuntime(client, commService);
    const sessions = new Map([
      [
        8,
        {
          kernelRuntime: runtime,
          notebook: { cells: [] },
        },
      ],
    ]);
    const cmdSink: string[] = [];
    const ctx = makeCtx(sessions, cmdSink);

    const dispatcher = buildRestartDispatcher(ctx);
    await dispatcher.restartKernel(8);

    assertEquals(
      commService.list().length,
      0,
      "the open comm must be cleared because RESTART_HANDSHAKE_FAILED means the kernel-side comm map is already wiped (REST 200 succeeded)",
    );
    assertEquals(
      runtime.execState,
      "idle",
      "execState must be restored to idle on restart failure",
    );
  });
});
