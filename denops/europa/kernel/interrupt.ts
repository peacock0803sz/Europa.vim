/**
 * REST interrupt for in-flight Jupyter kernel execution.
 *
 * Sends a single POST /api/kernels/{kid}/interrupt request.
 * All routing logic (idle guard, reconnect guard) lives in the dispatcher
 * layer (main.ts interruptKernel). This module is a pure REST wrapper.
 *
 * @module denops/europa/kernel/interrupt
 * @category Kernel
 */

import type { KernelRuntime } from "../../../contracts/kernel-client.ts";
import { buildAuthHeader } from "./auth.ts";
import { EuropaKernelError } from "./errors.ts";

/**
 * Send REST POST /api/kernels/{kid}/interrupt to the Jupyter server.
 *
 * Sends exactly one request (SC-007 equivalent for interrupt) with the
 * Authorization header produced by auth.ts. The kernel-side effect
 * (KeyboardInterrupt in the running code) arrives asynchronously via the
 * existing execute() message loop.
 *
 * @param runtime - Live KernelRuntime (uses kernelId and abort signal)
 * @param baseUrl - Jupyter server base URL (e.g. "http://localhost:8888")
 * @param token - Authentication token for Authorization header
 * @throws EuropaKernelError(INTERRUPT_REST_FAILED) on non-2xx response
 * @spec-id europa.kernel.interrupt.rest-204
 * @spec-id europa.kernel.interrupt.token-header
 */
export async function interrupt(
  runtime: KernelRuntime,
  baseUrl: string,
  token: string,
): Promise<void> {
  const url = `${baseUrl}/api/kernels/${runtime.info.kernelId}/interrupt`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: buildAuthHeader(token) },
    signal: runtime.abort.signal,
  });
  if (!resp.ok) {
    await resp.text().catch(() => {});
    throw new EuropaKernelError(
      "INTERRUPT_REST_FAILED",
      `interrupt REST failed: ${resp.status} ${resp.statusText}`,
    );
  }
  // 204 No Content: no body to consume
  await resp.arrayBuffer().catch(() => {});
}
