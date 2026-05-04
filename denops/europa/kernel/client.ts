/**
 * Factory for KernelClient instances.
 *
 * Phase 3.2: always returns a ServerKernelClient (HTTP+WebSocket).
 * Phase 4 will add a 'zmq' branch here when connectionMode === 'zmq'.
 *
 * @module europa-kernel-factory
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import type { KernelClient } from "../../../contracts/kernel-client.ts";
import type { EuropaConfig } from "../../../schema/config.ts";
import { ServerKernelClient } from "./server-client.ts";
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
  return new ServerKernelClient(denops, config, pool);
}
