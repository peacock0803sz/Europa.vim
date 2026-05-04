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

/** All valid kernel error codes (11 values). */
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
