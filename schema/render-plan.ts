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
  col: Type.Integer({ minimum: 0 }),
  endCol: Type.Integer(),
  hlEol: Type.Optional(Type.Boolean()),
});
export type Highlight = Static<typeof HighlightSchema>;

export const VirtTextPositionSchema = Type.Union([
  Type.Literal("right_align"),
  Type.Literal("eol"),
  Type.Literal("below"),
  Type.Literal("above"),
]);

export const VirtTextSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  text: Type.String(),
  position: VirtTextPositionSchema,
  hlGroup: Type.Optional(Type.String()),
});
export type VirtText = Static<typeof VirtTextSchema>;

export const ImagePlacementSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  col: Type.Integer({ minimum: 0 }),
  rows: Type.Integer({ minimum: 1 }),
  cols: Type.Integer({ minimum: 1 }),
  path: Type.String(),
  sourceMime: Type.String(),
});
export type ImagePlacement = Static<typeof ImagePlacementSchema>;

export const ClickActionSchema = Type.Union([
  Type.Object({ type: Type.Literal("open_url"), payload: Type.String() }),
  Type.Object({
    type: Type.Literal("scroll_to_cell"),
    payload: Type.String(),
  }),
  Type.Object({ type: Type.Literal("toggle_fold"), payload: Type.String() }),
]);

export const ClickableSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  colStart: Type.Integer({ minimum: 0 }),
  colEnd: Type.Integer(),
  action: ClickActionSchema,
});
export type Clickable = Static<typeof ClickableSchema>;

export const RenderPlanSchema = Type.Object({
  lines: Type.Array(Type.String()),
  highlights: Type.Array(HighlightSchema),
  virtText: Type.Array(VirtTextSchema),
  imagePlacements: Type.Array(ImagePlacementSchema),
  clickables: Type.Array(ClickableSchema),
  cellMap: Type.Array(
    Type.Object({
      cellIndex: Type.Integer({ minimum: 0 }),
      bufLineStart: Type.Integer({ minimum: 0 }),
      bufLineEnd: Type.Integer({ minimum: 0 }),
    }),
  ),
});
export type RenderPlan = Static<typeof RenderPlanSchema>;
