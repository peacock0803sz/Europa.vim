/**
 * BDD specs for EuropaKernelError and KernelErrorCode.
 *
 * @spec-id europa.kernel.errors.code-classification
 * @spec-id europa.kernel.errors.cause-chain
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf } from "@std/assert";
import {
  EuropaKernelError,
  KERNEL_ERROR_CODES,
} from "../../../denops/europa/kernel/errors.ts";
import type { KernelErrorCode } from "../../../denops/europa/kernel/errors.ts";

describe("EuropaKernelError — basic properties", () => {
  it("name is EuropaKernelError", () => {
    const err = new EuropaKernelError("JUPYTER_NOT_FOUND", "not found");
    assertEquals(err.name, "EuropaKernelError");
  });

  it("message is set from constructor", () => {
    const err = new EuropaKernelError("SPAWN_TIMEOUT", "timeout after 30s");
    assertEquals(err.message, "timeout after 30s");
  });

  it("code is set from constructor", () => {
    const err = new EuropaKernelError("TOKEN_MISSING", "no token");
    assertEquals(err.code, "TOKEN_MISSING");
  });

  it("cause is undefined when not provided", () => {
    const err = new EuropaKernelError("CONFIG_INVALID", "bad config");
    assertEquals(err.cause, undefined);
  });

  it("cause is set from third arg", () => {
    const origin = new TypeError("original");
    const err = new EuropaKernelError("CONNECTION_REFUSED", "refused", origin);
    assertEquals(err.cause, origin);
  });

  it("is instanceof Error", () => {
    const err = new EuropaKernelError("INVALID_ARGS", "bad args");
    assertInstanceOf(err, Error);
  });

  it("is instanceof EuropaKernelError", () => {
    const err = new EuropaKernelError("INVALID_ARGS", "bad args");
    assertInstanceOf(err, EuropaKernelError);
  });
});

describe("EuropaKernelError — cause chain", () => {
  it("cause chain: error.cause instanceof Error", () => {
    const root = new RangeError("root");
    const err = new EuropaKernelError(
      "RECONNECT_EXHAUSTED",
      "max retries",
      root,
    );
    assertInstanceOf(err.cause, Error);
    assertEquals((err.cause as Error).message, "root");
  });

  it("cause can be non-Error (e.g. string)", () => {
    const err = new EuropaKernelError(
      "KERNEL_INFO_FAILED",
      "reply error",
      "string cause",
    );
    assertEquals(err.cause, "string cause");
  });
});

describe("KernelErrorCode — 11 values", () => {
  const EXPECTED_CODES: KernelErrorCode[] = [
    "JUPYTER_NOT_FOUND",
    "SPAWN_TIMEOUT",
    "PORT_CONFLICT",
    "SUBPROTOCOL_REJECTED",
    "KERNEL_INFO_TIMEOUT",
    "KERNEL_INFO_FAILED",
    "TOKEN_MISSING",
    "CONNECTION_REFUSED",
    "RECONNECT_EXHAUSTED",
    "CONFIG_INVALID",
    "INVALID_ARGS",
  ];

  it("KERNEL_ERROR_CODES exports all 11 codes", () => {
    assertEquals(KERNEL_ERROR_CODES.length, 11);
  });

  it("all 11 expected codes are present", () => {
    for (const code of EXPECTED_CODES) {
      assertEquals(
        KERNEL_ERROR_CODES.includes(code),
        true,
        `Missing code: ${code}`,
      );
    }
  });

  it("each code can be used as EuropaKernelError.code", () => {
    for (const code of EXPECTED_CODES) {
      const err = new EuropaKernelError(code, `test ${code}`);
      assertEquals(err.code, code);
    }
  });
});
