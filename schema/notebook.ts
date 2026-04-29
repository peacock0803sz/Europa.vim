/**
 * TypeBox schema definitions for nbformat v4 Notebook structures.
 *
 * This module is the Source of Truth (SoT 1) for all Notebook-related types.
 * Implementation modules derive types via `Static<typeof Schema>` only.
 *
 * @module schema/notebook
 */

import { type Static, Type } from "@sinclair/typebox";

/** MIME bundle: maps MIME type to string content, string arrays, or JSON object. */
export const MimeBundleSchema = Type.Record(
  Type.String(),
  Type.Union([
    Type.String(),
    Type.Array(Type.String()),
    Type.Record(Type.String(), Type.Any()),
  ]),
);
export type MimeBundle = Static<typeof MimeBundleSchema>;

export const StreamOutputSchema = Type.Object({
  output_type: Type.Literal("stream"),
  name: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
  text: Type.String(),
});
export type StreamOutput = Static<typeof StreamOutputSchema>;

export const DisplayDataOutputSchema = Type.Object({
  output_type: Type.Literal("display_data"),
  data: MimeBundleSchema,
  metadata: Type.Object({}, { additionalProperties: true }),
  transient: Type.Optional(Type.Object({}, { additionalProperties: true })),
});
export type DisplayDataOutput = Static<typeof DisplayDataOutputSchema>;

export const ExecuteResultOutputSchema = Type.Object({
  output_type: Type.Literal("execute_result"),
  execution_count: Type.Union([Type.Integer(), Type.Null()]),
  data: MimeBundleSchema,
  metadata: Type.Object({}, { additionalProperties: true }),
});
export type ExecuteResultOutput = Static<typeof ExecuteResultOutputSchema>;

export const ErrorOutputSchema = Type.Object({
  output_type: Type.Literal("error"),
  ename: Type.String(),
  evalue: Type.String(),
  traceback: Type.Array(Type.String()),
});
export type ErrorOutput = Static<typeof ErrorOutputSchema>;

export const OutputSchema = Type.Union([
  StreamOutputSchema,
  DisplayDataOutputSchema,
  ExecuteResultOutputSchema,
  ErrorOutputSchema,
]);
export type Output = Static<typeof OutputSchema>;

export const CellMetadataSchema = Type.Object({}, {
  additionalProperties: true,
});
export type CellMetadata = Static<typeof CellMetadataSchema>;

/** cell.id pattern per nbformat 4.5 spec. */
const CellIdSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const CodeCellSchema = Type.Object({
  cell_type: Type.Literal("code"),
  id: CellIdSchema,
  source: Type.String(),
  execution_count: Type.Union([Type.Integer(), Type.Null()]),
  outputs: Type.Array(OutputSchema),
  metadata: CellMetadataSchema,
});
export type CodeCell = Static<typeof CodeCellSchema>;

export const MarkdownCellSchema = Type.Object({
  cell_type: Type.Literal("markdown"),
  id: CellIdSchema,
  source: Type.String(),
  attachments: Type.Optional(Type.Record(Type.String(), MimeBundleSchema)),
  metadata: CellMetadataSchema,
});
export type MarkdownCell = Static<typeof MarkdownCellSchema>;

export const RawCellSchema = Type.Object({
  cell_type: Type.Literal("raw"),
  id: CellIdSchema,
  source: Type.String(),
  metadata: CellMetadataSchema,
});
export type RawCell = Static<typeof RawCellSchema>;

export const CellSchema = Type.Union([
  CodeCellSchema,
  MarkdownCellSchema,
  RawCellSchema,
]);
export type Cell = Static<typeof CellSchema>;

export const NotebookMetadataSchema = Type.Object({
  kernelspec: Type.Optional(Type.Object({
    display_name: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
  }, { additionalProperties: true })),
  language_info: Type.Optional(Type.Object({
    name: Type.Optional(Type.String()),
  }, { additionalProperties: true })),
}, { additionalProperties: true });
export type NotebookMetadata = Static<typeof NotebookMetadataSchema>;

export const NotebookSchema = Type.Object({
  nbformat: Type.Literal(4),
  nbformat_minor: Type.Integer({ minimum: 0 }),
  metadata: NotebookMetadataSchema,
  cells: Type.Array(CellSchema),
});
export type Notebook = Static<typeof NotebookSchema>;

/**
 * Pre-normalize schema: accepts source / outputs[].text as string[] in addition
 * to string, to accommodate raw nbformat files before normalization.
 *
 * @see R1 in research.md for the two-pass validation strategy.
 */
const StringOrStringArray = Type.Union([
  Type.String(),
  Type.Array(Type.String()),
]);

const PreNormalizeOutputSchema = Type.Union([
  Type.Object({
    output_type: Type.Literal("stream"),
    name: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
    text: StringOrStringArray,
  }),
  DisplayDataOutputSchema,
  ExecuteResultOutputSchema,
  ErrorOutputSchema,
]);

const PreNormalizeCellSchema = Type.Union([
  Type.Object({
    cell_type: Type.Literal("code"),
    id: Type.Optional(CellIdSchema),
    source: StringOrStringArray,
    execution_count: Type.Optional(
      Type.Union([Type.Integer(), Type.Null()]),
    ),
    outputs: Type.Optional(Type.Array(PreNormalizeOutputSchema)),
    metadata: Type.Optional(CellMetadataSchema),
  }),
  Type.Object({
    cell_type: Type.Literal("markdown"),
    id: Type.Optional(CellIdSchema),
    source: StringOrStringArray,
    attachments: Type.Optional(Type.Record(Type.String(), MimeBundleSchema)),
    metadata: Type.Optional(CellMetadataSchema),
  }),
  Type.Object({
    cell_type: Type.Literal("raw"),
    id: Type.Optional(CellIdSchema),
    source: StringOrStringArray,
    metadata: Type.Optional(CellMetadataSchema),
  }),
]);

export const NotebookSchemaPreNormalize = Type.Object({
  nbformat: Type.Literal(4),
  nbformat_minor: Type.Integer({ minimum: 0 }),
  metadata: NotebookMetadataSchema,
  cells: Type.Array(PreNormalizeCellSchema),
});
export type NotebookPreNormalize = Static<typeof NotebookSchemaPreNormalize>;
