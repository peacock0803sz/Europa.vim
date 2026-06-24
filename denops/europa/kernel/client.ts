/**
 * Factory for KernelClient instances.
 *
 * Phase 3.2: createKernelClient always returns a ServerKernelClient.
 * Phase 4.1: createZmqKernelClient is a separate factory called unconditionally
 * by :EuropaAttach — no connection_mode branch, so an explicit attach never
 * silently falls back to the server path (D1).
 *
 * @module europa-kernel-factory
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import type { KernelClient } from "../../../contracts/kernel-client.ts";
import type { EuropaConfig } from "../../../schema/config.ts";
import { ServerKernelClient } from "./server-client.ts";
import { ZmqKernelClient } from "./zmq-client.ts";
import type { ServerPool } from "./server-pool.ts";

/**
 * Construct a KernelClient appropriate for the current config.
 *
 * @category Kernel
 */
export function createKernelClient(
  denops: Denops,
  config: EuropaConfig,
  pool: ServerPool,
): KernelClient {
  return new ServerKernelClient(denops, config, pool, {
    kernelInfoTimeoutMs: config.kernelInfoTimeoutMs,
  });
}

/**
 * Construct a ZmqKernelClient for an explicit `:EuropaAttach` invocation.
 *
 * Separate from createKernelClient(): `:EuropaAttach` is itself the explicit
 * trigger, so this is called unconditionally rather than branching on
 * config.connection_mode === 'zmq'. The default mode is 'auto', which would
 * silently route an explicit attach to the server path — a Gate-V (no silent
 * fallback) violation. The connection_mode='auto' routing heuristic is deferred
 * to a follow-up slice (FR-007).
 *
 * @category Kernel
 */
export function createZmqKernelClient(
  denops: Denops,
  config: EuropaConfig,
  connectionFile: string,
): KernelClient {
  return new ZmqKernelClient(denops, config, connectionFile, {
    kernelInfoTimeoutMs: config.kernelInfoTimeoutMs,
  });
}
