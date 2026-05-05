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

describe("KernelErrorCode — Phase 3.2 codes (11 values)", () => {
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

  it("KERNEL_ERROR_CODES exports all 16 codes (11 Phase 3.2 + 5 Phase 3.3)", () => {
    assertEquals(KERNEL_ERROR_CODES.length, 16);
  });

  it("all 11 Phase 3.2 codes are present", () => {
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

// ---------------------------------------------------------------------------
// Phase 3.3: 5 new error codes
// @spec-id europa.kernel.errors.code-classification-phase3-3
// ---------------------------------------------------------------------------

describe("KernelErrorCode — Phase 3.3 additions (16 values total)", () => {
  const PHASE33_CODES: KernelErrorCode[] = [
    "EXECUTE_TIMEOUT",
    "EXECUTE_REENTRANT",
    "INTERRUPT_REST_FAILED",
    "RESTART_REST_FAILED",
    "RESTART_HANDSHAKE_FAILED",
  ];

  it("KERNEL_ERROR_CODES exports all 16 codes after Phase 3.3", () => {
    assertEquals(KERNEL_ERROR_CODES.length, 16);
  });

  it("all Phase 3.3 codes are present in KERNEL_ERROR_CODES", () => {
    for (const code of PHASE33_CODES) {
      assertEquals(
        KERNEL_ERROR_CODES.includes(code),
        true,
        `Missing Phase 3.3 code: ${code}`,
      );
    }
  });

  it("each Phase 3.3 code can be used as EuropaKernelError.code", () => {
    for (const code of PHASE33_CODES) {
      const err = new EuropaKernelError(code, `test ${code}`);
      assertEquals(err.code, code);
    }
  });

  it("EXECUTE_TIMEOUT cause chain: error.cause instanceof DOMException for AbortError", () => {
    const abort = new DOMException("signal aborted", "AbortError");
    const err = new EuropaKernelError(
      "EXECUTE_TIMEOUT",
      "execute timed out",
      abort,
    );
    assertInstanceOf(err.cause, DOMException);
    assertEquals((err.cause as DOMException).name, "AbortError");
  });

  it("INTERRUPT_REST_FAILED wraps a network error in cause", () => {
    const netErr = new TypeError("network error");
    const err = new EuropaKernelError(
      "INTERRUPT_REST_FAILED",
      "interrupt failed",
      netErr,
    );
    assertInstanceOf(err.cause, TypeError);
  });

  it("RESTART_REST_FAILED wraps a server error", () => {
    const err = new EuropaKernelError(
      "RESTART_REST_FAILED",
      "server 500",
      new Error("500"),
    );
    assertInstanceOf(err.cause, Error);
  });

  it("RESTART_HANDSHAKE_FAILED wraps a timeout", () => {
    const timeout = new DOMException("timeout", "TimeoutError");
    const err = new EuropaKernelError(
      "RESTART_HANDSHAKE_FAILED",
      "handshake timed out",
      timeout,
    );
    assertInstanceOf(err.cause, DOMException);
  });
});
