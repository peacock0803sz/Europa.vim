/**
 * Kernel authentication helpers: token resolution, auth header, subprotocol lists.
 *
 * Token resolution order (DESIGN.md §6.4):
 *   1. g:europa_jupyter_token (Vim var via denops)
 *   2. config.jupyter_token (EuropaConfig field)
 *   3. $JUPYTER_TOKEN environment variable
 *   4. Random 32-char hex (local spawn only)
 * Attach mode (use_subprocess=false) throws TOKEN_MISSING when no token is configured.
 *
 * @module europa-kernel-auth
 * @category Kernel
 */

import type { Denops } from "@denops/std";
import type { EuropaConfig } from "../../../schema/config.ts";
import { EuropaKernelError } from "./errors.ts";

/**
 * Resolve the Jupyter authentication token using the configured priority order.
 *
 * Priority (DESIGN.md §6.4):
 *   1. g:europa_jupyter_token (Vim global var)
 *   2. config.jupyter_token (non-empty)
 *   3. $JUPYTER_TOKEN environment variable
 *   4. Random 32-char hex token (subprocess/spawn mode only)
 *   Attach mode (useSubprocess=false) throws TOKEN_MISSING when steps 1-3 all empty.
 *
 * @param denops - Denops instance for g:europa_jupyter_token lookup
 * @param config - Europa config (may have jupyter_token field)
 * @param useSubprocess - True for spawn mode, false for attach mode
 * @returns Resolved authentication token (non-empty)
 * @throws EuropaKernelError(TOKEN_MISSING) if attach mode and no token found
 * @category Kernel
 * @spec-id europa.kernel.auth.token-priority
 */
export async function resolveToken(
  denops: Denops,
  config: EuropaConfig,
  useSubprocess: boolean,
): Promise<string> {
  // Priority 1: Vim global var g:europa_jupyter_token
  const vimToken = await denops.eval(
    `get(g:, 'europa_jupyter_token', '')`,
  ) as string;
  if (vimToken && vimToken.length > 0) return vimToken;

  // Priority 2: config.jupyter_token (set via EuropaConfigSchema)
  if (config.jupyter_token && config.jupyter_token.length > 0) {
    return config.jupyter_token;
  }

  // Priority 3: $JUPYTER_TOKEN environment variable
  // Guard against NotCapable when --allow-env is not granted (unit tests)
  let envToken: string | undefined;
  try {
    envToken = Deno.env.get("JUPYTER_TOKEN");
  } catch { /* NotCapable or PermissionDenied — treat as absent */ }
  if (envToken && envToken.length > 0) return envToken;

  // Priority 4: random token for local spawn mode
  if (useSubprocess) {
    return crypto.randomUUID().replaceAll("-", "");
  }

  // Attach mode requires an explicit token
  throw new EuropaKernelError(
    "TOKEN_MISSING",
    "Attach mode (use_subprocess=false) requires a token. " +
      "Set g:europa_jupyter_token or $JUPYTER_TOKEN.",
  );
}

/**
 * Build the Authorization header value for Jupyter REST API requests.
 *
 * @param token - Authentication token
 * @returns Header value string (without the "Authorization:" key)
 * @category Kernel
 */
export function buildAuthHeader(token: string): string {
  return `token ${token}`;
}

/**
 * Build the WebSocket subprotocol list based on config mode.
 *
 * Mode behavior (DESIGN.md §6.2):
 *   - 'auto': All 3 JupyterLab-style subprotocols (v1 + v1-token + v1-token-TOKEN)
 *   - 'v1':   v1 + v1-token-TOKEN (no bare v1-token)
 *   - 'default': [] (no subprotocol — plain text JSON)
 *
 * @param config - Europa config with jupyter_ws_subprotocol setting
 * @param token - Current auth token (used in token-suffixed subprotocol)
 * @returns Array of subprotocol strings to pass to new WebSocket(url, protocols)
 * @category Kernel
 * @spec-id europa.kernel.auth.subprotocol-strings
 * @spec-id europa.kernel.auth.subprotocol-mode-switch
 */
export function buildSubprotocols(
  config: EuropaConfig,
  token: string,
): string[] {
  const v1 = "v1.kernel.websocket.jupyter.org";
  const v1token = "v1.token.websocket.jupyter.org";
  const v1tokenToken = `v1.token.websocket.jupyter.org.${token}`;

  switch (config.jupyter_ws_subprotocol) {
    case "auto":
      return [v1, v1token, v1tokenToken];
    case "v1":
      return [v1, v1tokenToken];
    case "default":
    default:
      return [];
  }
}
