/**
 * Jupyter Server REST API helpers for session/kernel lifecycle.
 *
 * Contains `acquireServer` (server pool acquisition + URL resolution) and
 * `createSession` (POST /api/sessions). Extracted from ServerKernelClient
 * to keep server-client.ts under 400 lines.
 *
 * @module europa-kernel-session-api
 * @category Kernel
 */

import type { EuropaConfig } from "../../../schema/config.ts";
import { buildAuthHeader } from "./auth.ts";
import {
  makeLocalServerKey,
  makeRemoteServerKey,
  ServerPool,
} from "./server-pool.ts";
import {
  detectJupyterExecutable,
  spawnJupyterServer,
} from "./server-process.ts";

/** Acquire a Jupyter server handle and return `{ serverKey, baseUrl }`. */
export async function acquireServer(
  config: EuropaConfig,
  pool: ServerPool,
  token: string,
  opts: {
    cwd?: string;
    signal?: AbortSignal;
    detectExecutable: typeof detectJupyterExecutable;
    spawnServer: typeof spawnJupyterServer;
  },
): Promise<{ serverKey: string; baseUrl: string }> {
  if (config.use_subprocess) {
    const cwd = opts.cwd ?? Deno.cwd();
    const executable = await opts.detectExecutable(cwd, config);
    const serverKey = await makeLocalServerKey(executable);
    const handle = await pool.acquire(
      serverKey,
      () => opts.spawnServer(executable, { token, cwd, signal: opts.signal }),
    );
    return { serverKey, baseUrl: handle.url.replace(/\/+$/, "") };
  }
  const serverKey = makeRemoteServerKey(config.jupyter_url);
  const baseUrl = config.jupyter_url.replace(/\/+$/, "");
  const url = new URL(baseUrl);
  const port = url.port
    ? parseInt(url.port, 10)
    : (url.protocol === "https:" ? 443 : 80);
  await pool.acquire(
    serverKey,
    () => Promise.resolve({ port, token, url: baseUrl }),
  );
  return { serverKey, baseUrl };
}

/** POST /api/sessions and return `{ sessionId, kernelId }`. */
export async function createSession(
  baseUrl: string,
  token: string,
  kernelName: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ sessionId: string; kernelId: string }> {
  const resp = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "",
      path: cwd ?? "",
      type: "console",
      kernel: { name: kernelName },
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { id: string; kernel: { id: string } };
  return { sessionId: data.id, kernelId: data.kernel.id };
}
