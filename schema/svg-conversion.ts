/**
 * TypeBox schema for SVG → PNG conversion results (Phase 3.6).
 *
 * This module is the Source of Truth for `SvgConversionResult`.
 * Implementation modules derive the type via `Static<typeof SvgConversionResultSchema>`.
 *
 * @module schema/svg-conversion
 */

import { type Static, Type } from "@sinclair/typebox";

/**
 * Discriminated union representing the outcome of a single SVG → PNG
 * conversion attempt via `rsvg-convert`.
 *
 * - `ok: true`: conversion succeeded; carries PNG base64, dimensions, and
 *   the SHA-256 of the input SVG bytes (used as cache key).
 * - `ok: false`: conversion failed; carries a `reason` enum and optional
 *   stderr fragment from the subprocess.
 *
 * @spec-id europa.render.image.svg-rsvg
 */
export const SvgConversionResultSchema = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    pngBase64: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
    sha256: Type.String(),
  }),
  Type.Object({
    ok: Type.Literal(false),
    reason: Type.Union([
      Type.Literal("binary-missing"),
      Type.Literal("convert-failed"),
    ]),
    stderr: Type.Optional(Type.String()),
  }),
]);

export type SvgConversionResult = Static<typeof SvgConversionResultSchema>;
