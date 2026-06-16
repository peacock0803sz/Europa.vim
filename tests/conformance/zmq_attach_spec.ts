/**
 * Opt-in real-kernel conformance for direct ZeroMQ attach (Phase 4.1).
 *
 * Spawns a bare `jupyter kernel`, reads the connection_file path it prints, and
 * drives createZmqKernelClient().start/execute/shutdown against it. Verifies the
 * kernel_info handshake, an execute round-trip, and that shutdown closes sockets
 * without killing the foreign kernel (FR-010, SC-003).
 *
 * Gated by EUROPA_ZMQ_E2E=1 (set only by `deno task test:conformance:zmq`) so the
 * cross-OS `test:conformance` lane skips the whole describe before any zeromq
 * code runs — keeping that lane FFI-free. createZmqKernelClient lazy-imports
 * zeromq, so this file has no top-level zeromq import. Even with the flag set, it
 * skips gracefully when jupyter or the zeromq native binding is unavailable.
 *
 * @module tests/conformance/zmq_attach_spec
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createZmqKernelClient } from "../../denops/europa/kernel/client.ts";
import { EuropaKernelError } from "../../denops/europa/kernel/errors.ts";
import { ensureJupyter, JupyterMissingError } from "./setup.ts";
import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../schema/config.ts";
import type { KernelMessage } from "../../schema/message.ts";

const E2E = Deno.env.get("EUROPA_ZMQ_E2E") === "1";

/** Read `jupyter kernel` stderr until it prints the connection file path. */
async function readConnectionFile(
  stderr: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<string | null> {
  const reader = stderr.getReader();
  const dec = new TextDecoder();
  const deadline = performance.now() + timeoutMs;
  let acc = "";
  try {
    while (performance.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      const m = acc.match(/Connection file:\s*(\S+\.json)/);
      if (m) return m[1];
    }
  } finally {
    reader.releaseLock();
  }
  return null;
}

/** @spec-id europa.conformance.zmq-attach-e2e */
describe("conformance: ZMQ attach e2e (opt-in, EUROPA_ZMQ_E2E=1)", {
  ignore: !E2E,
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("attaches, executes, and shuts down without killing the kernel", async () => {
    try {
      await ensureJupyter();
    } catch (e) {
      if (e instanceof JupyterMissingError) return; // skip: no jupyter
      throw e;
    }

    const proc = new Deno.Command("jupyter", {
      args: ["kernel", "--kernel=python3"],
      stdout: "null",
      stderr: "piped",
    }).spawn();
    let kernelExited = false;
    proc.status.then(() => {
      kernelExited = true;
    });

    const connFile = await readConnectionFile(proc.stderr, 30_000);
    if (!connFile) {
      try {
        proc.kill("SIGTERM");
      } catch { /* already gone */ }
      await proc.status;
      return; // skip: kernel never reported a connection file
    }

    const config = { kernelInfoTimeoutMs: 15_000 } as unknown as EuropaConfig;
    const client = createZmqKernelClient(
      {} as unknown as Denops,
      config,
      connFile,
    );

    try {
      const runtime = await client.start({ kernelName: "", cwd: Deno.cwd() });
      assertEquals(runtime.info.connectionMode, "zmq");
      assertEquals(runtime.info.state, "idle");

      const msgs: KernelMessage[] = [];
      for await (const m of client.execute("print('hi')")) msgs.push(m);
      assertEquals(
        msgs.some((m) => m.header.msg_type === "execute_reply"),
        true,
        "an execute_reply must arrive on a real kernel",
      );

      await client.shutdown();
      // Non-owned shutdown: the kernel must still be alive (SC-003).
      await new Promise<void>((r) => setTimeout(r, 250));
      assertEquals(kernelExited, false, "shutdown must not kill the kernel");
    } catch (e) {
      if (
        e instanceof EuropaKernelError && e.code === "ZMQ_BINDING_UNAVAILABLE"
      ) {
        return; // skip: zeromq native binding not built
      }
      throw e;
    } finally {
      await client.shutdown();
      try {
        proc.kill("SIGTERM");
      } catch { /* already gone */ }
      await proc.status;
    }
  });
});
