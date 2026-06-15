/**
 * BDD specs for parseConnectionFile (Phase 4.1 connection-file parsing).
 *
 * Pure JSON + Value.Check + code-check, so these stay FFI-free: each case
 * writes a temp file and asserts either the parsed value or the error code.
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parseConnectionFile } from "../../../denops/europa/kernel/connection-file.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";

const VALID = {
  shell_port: 57503,
  iopub_port: 57504,
  stdin_port: 57505,
  control_port: 57506,
  hb_port: 57507,
  ip: "127.0.0.1",
  key: "a0b1c2d3-4e5f-6071-8293-a4b5c6d7e8f9",
  transport: "tcp",
  signature_scheme: "hmac-sha256",
  kernel_name: "python3",
};

async function writeCF(obj: unknown): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(
    path,
    typeof obj === "string" ? obj : JSON.stringify(obj),
  );
  return path;
}

async function expectCode(path: string, code: string): Promise<void> {
  const err = await assertRejects(
    () => parseConnectionFile(path),
    EuropaKernelError,
  );
  assertEquals((err as EuropaKernelError).code, code);
}

/** @spec-id europa.kernel.connection-file.parse */
describe("parseConnectionFile — valid files and read/JSON failures", () => {
  it("parses a valid tcp / hmac-sha256 connection file", async () => {
    const cf = await parseConnectionFile(await writeCF(VALID));
    assertEquals(cf.transport, "tcp");
    assertEquals(cf.shell_port, 57503);
    assertEquals(cf.kernel_name, "python3");
  });

  it("accepts an empty key (unsigned kernel)", async () => {
    const cf = await parseConnectionFile(await writeCF({ ...VALID, key: "" }));
    assertEquals(cf.key, "");
  });

  it("rejects a non-existent path with CONNECTION_FILE_INVALID", async () => {
    await expectCode("/no/such/dir/connection.json", "CONNECTION_FILE_INVALID");
  });

  it("rejects malformed JSON with CONNECTION_FILE_INVALID", async () => {
    await expectCode(
      await writeCF("{ not valid json"),
      "CONNECTION_FILE_INVALID",
    );
  });
});

/** @spec-id europa.kernel.connection-file.missing-key */
describe("parseConnectionFile — missing or out-of-range keys", () => {
  it("rejects a missing required key, naming it in the message", async () => {
    const { key: _key, ...noKey } = VALID;
    const path = await writeCF(noKey);
    const err = await assertRejects(
      () => parseConnectionFile(path),
      EuropaKernelError,
    );
    assertEquals((err as EuropaKernelError).code, "CONNECTION_FILE_INVALID");
    assertStringIncludes((err as Error).message, "key");
  });

  it("rejects an out-of-range port with CONNECTION_FILE_INVALID", async () => {
    await expectCode(
      await writeCF({ ...VALID, shell_port: 70000 }),
      "CONNECTION_FILE_INVALID",
    );
  });
});

/** @spec-id europa.kernel.connection-file.tcp-only-reject */
describe("parseConnectionFile — unsupported transport", () => {
  it("rejects ipc transport with CONNECTION_FILE_UNSUPPORTED_TRANSPORT", async () => {
    await expectCode(
      await writeCF({ ...VALID, transport: "ipc" }),
      "CONNECTION_FILE_UNSUPPORTED_TRANSPORT",
    );
  });
});

/** @spec-id europa.kernel.connection-file.unsupported-scheme */
describe("parseConnectionFile — unsupported signature scheme", () => {
  it("rejects hmac-sha1 with a non-empty key", async () => {
    await expectCode(
      await writeCF({ ...VALID, signature_scheme: "hmac-sha1" }),
      "CONNECTION_FILE_UNSUPPORTED_SCHEME",
    );
  });

  it("allows a non-hmac-sha256 scheme when the key is empty (unsigned)", async () => {
    const cf = await parseConnectionFile(
      await writeCF({ ...VALID, signature_scheme: "hmac-sha1", key: "" }),
    );
    assertEquals(cf.key, "");
  });
});
