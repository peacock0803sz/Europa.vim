/**
 * BDD specs for ZmqKernelClient.start / kernelInfo / onMessage (Phase 4.1 US1).
 *
 * FFI-free: the zeromq module is injected via the importZmq seam with the
 * in-memory transport double (tests/fixtures/mock-zmq-kernel.ts).
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ZmqKernelClient } from "../../../denops/europa/kernel/zmq-client.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";
import {
  makeMockZmqKernel,
  type MockZmqOptions,
} from "../../fixtures/mock-zmq-kernel.ts";
import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../../schema/config.ts";
import type { KernelMessage } from "../../../schema/message.ts";

async function collect(
  stream: AsyncIterable<KernelMessage>,
): Promise<KernelMessage[]> {
  const out: KernelMessage[] = [];
  for await (const msg of stream) out.push(msg);
  return out;
}

function parentId(msg: KernelMessage): string | undefined {
  return (msg.parent_header as { msg_id?: string }).msg_id;
}

const PARAMS = {
  shell_port: 60001,
  iopub_port: 60002,
  stdin_port: 60003,
  control_port: 60004,
  hb_port: 60005,
  ip: "127.0.0.1",
  key: "secret-key",
  signature_scheme: "hmac-sha256",
};

async function writeConnFile(): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(
    path,
    JSON.stringify({ ...PARAMS, transport: "tcp", kernel_name: "python3" }),
  );
  return path;
}

async function setup(
  mockOpts: MockZmqOptions = {},
  clientOpts: { kernelInfoTimeoutMs?: number; importFails?: boolean } = {},
) {
  const path = await writeConnFile();
  const mock = makeMockZmqKernel(PARAMS, mockOpts);
  const client = new ZmqKernelClient(
    {} as unknown as Denops,
    {} as unknown as EuropaConfig,
    path,
    {
      kernelInfoTimeoutMs: clientOpts.kernelInfoTimeoutMs ?? 2000,
      importZmq: clientOpts.importFails
        ? () => Promise.reject(new Error("no native binding"))
        : () =>
          Promise.resolve(mock.module as unknown as typeof import("zeromq")),
    },
  );
  return { client, mock };
}

/** @spec-id europa.kernel.zmq-client.start-attach */
describe("ZmqKernelClient.start — attach", () => {
  it("parses, connects 5 sockets, handshakes, and returns a zmq runtime", async () => {
    const { client } = await setup();
    const runtime = await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      assertEquals(runtime.info.connectionMode, "zmq");
      assertEquals(runtime.zmq !== undefined, true);
      assertEquals(runtime.info.kernelName, "python3");
      assertEquals(runtime.info.state, "idle");
      assertEquals(runtime.serverKey, "zmq");
    } finally {
      await client.shutdown();
    }
  });

  it("rejects with ZMQ_BINDING_UNAVAILABLE when the import fails", async () => {
    const { client } = await setup({}, { importFails: true });
    const err = await assertRejects(
      () => client.start({ kernelName: "", cwd: "/tmp" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "ZMQ_BINDING_UNAVAILABLE");
  });

  it("rejects with KERNEL_INFO_TIMEOUT when no reply arrives", async () => {
    const { client } = await setup(
      { respondToKernelInfo: false },
      { kernelInfoTimeoutMs: 60 },
    );
    const err = await assertRejects(
      () => client.start({ kernelName: "", cwd: "/tmp" }),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "KERNEL_INFO_TIMEOUT");
  });
});

/** @spec-id europa.kernel.zmq-client.kernel-info-handshake */
describe("ZmqKernelClient.start — kernel_info handshake", () => {
  it("synthesizes UUIDs and fills info from the reply", async () => {
    const { client } = await setup();
    const runtime = await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      assertEquals(typeof runtime.info.kernelId, "string");
      assertEquals(runtime.info.kernelId.length > 0, true);
      assertEquals(runtime.info.sessionId.length > 0, true);
      assertEquals(runtime.info.subprotocol, "none");
      assertEquals(runtime.info.languageInfo?.name, "python");
      assertEquals(typeof runtime.info.banner, "string");
    } finally {
      await client.shutdown();
    }
  });
});

/** @spec-id europa.kernel.zmq-client.slow-joiner-sync */
describe("ZmqKernelClient.start — slow-joiner readiness", () => {
  it("becomes ready on the shell reply even if iopub status is missed", async () => {
    // scriptExecute is irrelevant here; the point is no iopub status before ready.
    const { client } = await setup();
    const runtime = await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      // start() resolved purely from the shell kernel_info_reply.
      assertEquals(runtime.info.state, "idle");
    } finally {
      await client.shutdown();
    }
  });
});

/** @spec-id europa.contract.kernel-runtime-transport */
describe("ZmqKernelClient — KernelRuntime transport invariant", () => {
  it("fills zmq and leaves socket undefined (exactly one transport)", async () => {
    const { client } = await setup();
    const runtime = await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      assertEquals(runtime.socket, undefined);
      assertEquals(runtime.zmq !== undefined, true);
      // invariant: exactly one of socket / zmq is set.
      assertEquals(
        (runtime.socket === undefined) !== (runtime.zmq === undefined),
        true,
      );
    } finally {
      await client.shutdown();
    }
  });
});

/** @spec-id europa.kernel.zmq-client.execute */
describe("ZmqKernelClient.execute", () => {
  it("yields the iopub sequence and reply correlated by msg_id", async () => {
    const { client } = await setup();
    await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      const msgs = await collect(
        client.execute("print(1)", { msgId: "exec-1" }),
      );
      for (const m of msgs) assertEquals(parentId(m), "exec-1");
      const types = msgs.map((m) => m.header.msg_type);
      assertEquals(types.includes("execute_reply"), true);
      assertEquals(types.includes("stream"), true);
      assertEquals(
        msgs.some((m) =>
          m.header.msg_type === "status" &&
          (m.content as { execution_state?: string }).execution_state === "idle"
        ),
        true,
        "stream must terminate after status:idle",
      );
    } finally {
      await client.shutdown();
    }
  });

  it("does not mix concurrent cells (US2 AC#5)", async () => {
    const { client } = await setup();
    await client.start({ kernelName: "", cwd: "/tmp" });
    try {
      const [a, b] = await Promise.all([
        collect(client.execute("a", { msgId: "cell-a" })),
        collect(client.execute("b", { msgId: "cell-b" })),
      ]);
      assertEquals(a.length > 0, true);
      assertEquals(b.length > 0, true);
      for (const m of a) assertEquals(parentId(m), "cell-a");
      for (const m of b) assertEquals(parentId(m), "cell-b");
    } finally {
      await client.shutdown();
    }
  });
});
