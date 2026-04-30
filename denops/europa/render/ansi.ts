/**
 * ANSI escape code stripping utilities.
 *
 * Thin wrapper over `@lambdalisue/ansi-escape-code`; self-built regex is
 * intentionally avoided so ANSI sequence handling is delegated to the library,
 * including CSI/OSC/DCS support where available, which may vary by version.
 *
 * @category Render
 * @module ansi
 */

import { trimAndParse } from "@lambdalisue/ansi-escape-code";

/**
 * Strip all ANSI escape sequences from `text`.
 *
 * Uses `trimAndParse` from `@lambdalisue/ansi-escape-code`, taking `[0]`
 * (the stripped string) from the returned tuple.
 *
 * @param text - Raw text potentially containing ANSI escape codes.
 * @returns Text with all ANSI sequences removed.
 * @spec-id europa.render.ansi.strip
 */
export function stripAnsi(text: string): string {
  return trimAndParse(text)[0];
}
