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

/** A single renderable unit produced by `dispatchOutput` or a renderer. */
export const RenderFragmentSchema = Type.Object({
  lines: Type.Array(Type.String()),
  highlights: Type.Array(HighlightSchema),
  virtText: Type.Array(VirtTextSchema),
  imagePlacements: Type.Array(ImagePlacementSchema),
  clickables: Type.Array(ClickableSchema),
});
export type RenderFragment = Static<typeof RenderFragmentSchema>;

/** Metadata for a future Sixel image placement (wired in Phase 3/T103). */
export const SixelPlacementSchema = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  payload: Type.String(),
  mime: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
  width: Type.Optional(Type.Integer({ minimum: 0 })),
  height: Type.Optional(Type.Integer({ minimum: 0 })),
  backend: Type.Literal("sixel"),
  cellIdx: Type.Integer({ minimum: 0 }),
  outputIdx: Type.Integer({ minimum: 0 }),
});
export type SixelPlacement = Static<typeof SixelPlacementSchema>;

/** Return value of `renderImage`: a placeholder fragment plus optional Sixel metadata. */
export const ImageRenderResultSchema = Type.Object({
  fragment: RenderFragmentSchema,
  placement: Type.Optional(SixelPlacementSchema),
});
export type ImageRenderResult = Static<typeof ImageRenderResultSchema>;

/** Line range covered by a single cell in the viewer buffer. */
export const CellRangeSchema = Type.Object({
  cellId: Type.String(),
  startLine: Type.Integer({ minimum: 0 }),
  endLine: Type.Integer({ minimum: 0 }),
});
export type CellRange = Static<typeof CellRangeSchema>;

/** Options controlling cell borders and output limits passed to buildRenderPlan. */
export const BuildRenderPlanOptsSchema = Type.Object({
  maxOutputLines: Type.Optional(Type.Integer({ minimum: 0 })),
  mimePriority: Type.Optional(Type.Array(Type.String())),
  cellBorderChars: Type.Optional(Type.Array(Type.String())),
  cellBorderPadding: Type.Optional(Type.Integer({ minimum: 0 })),
  cellBorderAlign: Type.Optional(Type.Union([
    Type.Literal("center"),
    Type.Literal("left"),
  ])),
});
export type BuildRenderPlanOpts = Static<typeof BuildRenderPlanOptsSchema>;

export const RenderPlanSchema = Type.Object({
  lines: Type.Array(Type.String()),
  highlights: Type.Array(HighlightSchema),
  virtText: Type.Array(VirtTextSchema),
  imagePlacements: Type.Array(ImagePlacementSchema),
  sixelPlacements: Type.Optional(Type.Array(SixelPlacementSchema)),
  clickables: Type.Array(ClickableSchema),
  cellMap: Type.Array(
    Type.Object({
      cellIndex: Type.Integer({ minimum: 0 }),
      bufLineStart: Type.Integer({ minimum: 0 }),
      bufLineEnd: Type.Integer({ minimum: 0 }),
    }),
  ),
  cellRanges: Type.Array(CellRangeSchema),
});
export type RenderPlan = Static<typeof RenderPlanSchema>;
