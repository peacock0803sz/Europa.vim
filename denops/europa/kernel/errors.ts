/**
 * EuropaKernelError and KernelErrorCode definitions.
 *
 * All kernel-related errors thrown by Europa are instances of this class.
 * The `code` field enables callers to distinguish error kinds without string
 * matching on the message (which is subject to change).
 *
 * @module europa-kernel-errors
 * @category Kernel
 * @spec-id europa.kernel.errors.code-classification
 * @spec-id europa.kernel.errors.cause-chain
 */

/**
 * All valid kernel error codes (17 values; 11 Phase 3.2 + 5 Phase 3.3 + 1 Phase 5.1).
 * @spec-id europa.kernel.errors.code-classification-phase3-3
 */
export const KERNEL_ERROR_CODES = [
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
  // Phase 3.3 additions
  "EXECUTE_TIMEOUT",
  "EXECUTE_REENTRANT",
  "INTERRUPT_REST_FAILED",
  "RESTART_REST_FAILED",
  "RESTART_HANDSHAKE_FAILED",
  // Phase 5.1: single-site gate that sendComm must raise during reconnect
  // because silent buffering would let the kernel drift into 'unknown
  // comm_id'. Callers must retry once runtime state returns to 'connected'.
  "KERNEL_RECONNECTING",
] as const;

export type KernelErrorCode = typeof KERNEL_ERROR_CODES[number];

/**
 * Typed error for all kernel lifecycle failures in Europa.
 *
 * @example
 * ```ts
 * throw new EuropaKernelError("JUPYTER_NOT_FOUND", "jupyter not in PATH");
 * throw new EuropaKernelError("TOKEN_MISSING", "token required for attach mode", originalErr);
 * ```
 */
export class EuropaKernelError extends Error {
  override readonly name = "EuropaKernelError";
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}
