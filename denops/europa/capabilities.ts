/**
 * Capability detection for the Europa plugin host.
 *
 * Reads `g:europa_image_backend` and `denops.meta` to build a `Capabilities`
 * object. In Phase 2, `auto` always resolves to `placeholder` (FR-023, R11).
 *
 * @module capabilities
 */

import type { Denops } from "@denops/std";
import { Value } from "@sinclair/typebox/value";
import {
  type Capabilities,
  HostKindSchema,
  type ImageProtocol,
} from "../../schema/capabilities.ts";

/**
 * Detect host capabilities from the current Denops environment.
 *
 * Reads `g:europa_image_backend` for the image protocol override.
 * An `"auto"` value (or missing/null) resolves to `"placeholder"` in Phase 2.
 *
 * @param denops - Denops instance providing host metadata and eval access.
 * @returns Validated `Capabilities` record.
 * @spec-id europa.capabilities.host
 * @spec-id europa.capabilities.auto-resolves-placeholder
 * @spec-id europa.capabilities.explicit-override
 * @spec-id europa.contract.capabilities-alignment
 */
export async function detectCapabilities(
  denops: Denops,
): Promise<Capabilities> {
  const host = denops.meta.host;
  const hostVersion = denops.meta.version;

  // Validate host kind — unknown hosts default to "vim"
  const hostKind = Value.Check(HostKindSchema, host) ? host : "vim";

  // Read image backend preference
  const rawBackend = await denops.eval("g:europa_image_backend").catch(
    () => null,
  );

  const image = resolveImageProtocol(rawBackend);

  return { host: hostKind as "vim" | "nvim", hostVersion, image };
}

function resolveImageProtocol(raw: unknown): ImageProtocol {
  if (
    raw === "sixel" ||
    raw === "kitty_placeholder" ||
    raw === "iterm2_osc1337" ||
    raw === "placeholder"
  ) {
    return raw;
  }
  // "auto" or null/undefined → placeholder (Phase 2 invariant, FR-023)
  return "placeholder";
}
