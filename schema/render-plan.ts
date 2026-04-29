/**
 * TypeBox schema for the RenderPlan intermediate representation.
 *
 * This module is the Source of Truth (SoT 1) for all render pipeline types.
 * The viewer applies a RenderPlan to a buffer; the render layer produces it.
 *
 * @module schema/render-plan
 */

import { type Static, Type } from "@sinclair/typebox";

export const HighlightSchema = Type.Object({
  hlGroup: Type.String(),
  line: Type.Integer({ minimum: 0 }),
  colStart: Type.Integer({ minimum: 0 }),
  colEnd: Type.Integer({ minimum: 0 }),
});
export type Highlight = Static<typeof HighlightSchema>;

export const VirtTextSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  text: Type.String(),
  hlGroup: Type.String(),
  position: Type.Union([
    Type.Literal("above"),
    Type.Literal("below"),
    Type.Literal("right"),
  ]),
});
export type VirtText = Static<typeof VirtTextSchema>;

export const ImagePlacementSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  payload: Type.String(),
  mime: Type.Union([
    Type.Literal("image/png"),
    Type.Literal("image/jpeg"),
  ]),
  width: Type.Integer({ minimum: 0 }),
  height: Type.Integer({ minimum: 0 }),
  backend: Type.Union([
    Type.Literal("sixel"),
    Type.Literal("kitty_placeholder"),
    Type.Literal("iterm2_osc1337"),
  ]),
  cellIdx: Type.Integer({ minimum: 0 }),
  outputIdx: Type.Integer({ minimum: 0 }),
});
export type ImagePlacement = Static<typeof ImagePlacementSchema>;

export const ClickableSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  command: Type.String(),
});
export type Clickable = Static<typeof ClickableSchema>;

export const RenderFragmentSchema = Type.Object({
  lines: Type.Array(Type.String()),
  highlights: Type.Array(HighlightSchema),
  virtText: Type.Array(VirtTextSchema),
  imagePlacements: Type.Optional(Type.Array(ImagePlacementSchema)),
  clickables: Type.Optional(Type.Array(ClickableSchema)),
});
export type RenderFragment = Static<typeof RenderFragmentSchema>;

export const RenderPlanSchema = Type.Object({
  bufnr: Type.Integer({ minimum: 0 }),
  fragments: Type.Array(RenderFragmentSchema),
  cellMap: Type.Record(Type.String(), Type.Integer()),
});
export type RenderPlan = Static<typeof RenderPlanSchema>;
