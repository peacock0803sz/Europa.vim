/**
 * BDD specs for the interrupt() execute-layer function.
 *
 * @spec-id europa.kernel.interrupt.rest-204
 * @spec-id europa.kernel.interrupt.token-header
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { interrupt } from "../../../denops/europa/kernel/interrupt.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";
import type { KernelRuntime } from "../../../contracts/kernel-client.ts";

/** Minimal KernelRuntime stub for interrupt() tests. */
function makeRuntime(kernelId: string): KernelRuntime {
  return {
    info: {
      kernelId,
      sessionId: "sess-1",
      kernelName: "python3",
      connectionMode: "server",
      state: "idle",
      subprotocol: "default",
      startedAt: new Date().toISOString(),
    },
    abort: new AbortController(),
    socket: null as unknown as WebSocket,
    serverKey: "remote:http://localhost/",
    client: null as unknown as KernelRuntime["client"],
    pendingRequests: new Map(),
    execState: "idle",
    cellStates: new Map(),
  };
}

describe(
  "interrupt() REST layer",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    const KERNEL_ID = "test-kernel-abc";
    const TOKEN = "secret-token-123";
    let server: Deno.HttpServer | null = null;
    let lastRequest: Request | null = null;
    let responseStatus = 204;

    beforeEach(() => {
      lastRequest = null;
      responseStatus = 204;
      server = Deno.serve(
        { port: 0, hostname: "127.0.0.1", onListen: () => {} },
        (req) => {
          // Clone to keep headers accessible after handler returns (Deno closes orig)
          lastRequest = new Request(req.url, {
            method: req.method,
            headers: req.headers,
          });
          const url = new URL(req.url);
          if (
            req.method === "POST" &&
            url.pathname.endsWith("/interrupt")
          ) {
            return new Response(null, { status: responseStatus });
          }
          return new Response("Not Found", { status: 404 });
        },
      );
    });

    afterEach(async () => {
      await server?.shutdown();
      server = null;
    });

    it(
      "(a) POST /api/kernels/{kid}/interrupt → 204 resolves",
      async () => {
        const baseUrl = `http://127.0.0.1:${
          (server!.addr as Deno.NetAddr).port
        }`;
        const runtime = makeRuntime(KERNEL_ID);

        await interrupt(runtime, baseUrl, TOKEN);

        assertEquals(lastRequest?.method, "POST");
        const url = new URL(lastRequest!.url);
        assertEquals(
          url.pathname,
          `/api/kernels/${KERNEL_ID}/interrupt`,
        );
      },
    );

    it(
      "(token-header) Authorization header carries token",
      async () => {
        const baseUrl = `http://127.0.0.1:${
          (server!.addr as Deno.NetAddr).port
        }`;
        const runtime = makeRuntime(KERNEL_ID);

        await interrupt(runtime, baseUrl, TOKEN);

        assertEquals(
          lastRequest?.headers.get("Authorization"),
          `token ${TOKEN}`,
        );
      },
    );

    it(
      "(d) 5xx response → INTERRUPT_REST_FAILED",
      async () => {
        responseStatus = 500;
        const baseUrl = `http://127.0.0.1:${
          (server!.addr as Deno.NetAddr).port
        }`;
        const runtime = makeRuntime(KERNEL_ID);

        const err = await assertRejects(
          () => interrupt(runtime, baseUrl, TOKEN),
        );
        assertInstanceOf(err, EuropaKernelError);
        assertEquals(err.code, "INTERRUPT_REST_FAILED");
      },
    );
  },
);
