/**
 * TypeBox schemas for Jupyter wire protocol messages.
 *
 * Defines Header, KernelMessage, LanguageInfo, and KernelInfoReply.
 * Phase 3.2 uses only kernel_info_request / kernel_info_reply; other
 * msg_types flow through KernelMessageSchema via the open content record.
 *
 * @module schema/message
 */

import { type Static, Type } from "@sinclair/typebox";

export const HeaderSchema = Type.Object({
  msg_id: Type.String(),
  msg_type: Type.String(),
  username: Type.String(),
  session: Type.String(),
  date: Type.String(),
  version: Type.String(),
});

export const KernelMessageSchema = Type.Object({
  header: HeaderSchema,
  parent_header: Type.Union([HeaderSchema, Type.Object({})]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  content: Type.Record(Type.String(), Type.Unknown()),
  buffers: Type.Array(Type.Uint8Array()),
});

export const LanguageInfoSchema = Type.Object({
  name: Type.String(),
  version: Type.String(),
  mimetype: Type.Optional(Type.String()),
  file_extension: Type.Optional(Type.String()),
});

export const KernelInfoReplySchema = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
  protocol_version: Type.String(),
  implementation: Type.String(),
  implementation_version: Type.String(),
  language_info: LanguageInfoSchema,
  banner: Type.String(),
  help_links: Type.Optional(
    Type.Array(
      Type.Object({ text: Type.String(), url: Type.String() }),
    ),
  ),
});

export type Header = Static<typeof HeaderSchema>;
export type KernelMessage = Static<typeof KernelMessageSchema>;
export type LanguageInfo = Static<typeof LanguageInfoSchema>;
export type KernelInfoReply = Static<typeof KernelInfoReplySchema>;

// ---------------------------------------------------------------------------
// Phase 3.3: per-msg_type content schemas (additive, SoT 1)
// KernelMessageSchema.content is unchanged (Record<string, unknown>).
// Use Value.Check(XxxContentSchema, msg.content) to narrow by msg_type.
// ---------------------------------------------------------------------------

/** execute_request content (R02: 6 fields fixed). */
export const ExecuteRequestContentSchema = Type.Object({
  code: Type.String(),
  silent: Type.Literal(false),
  store_history: Type.Literal(true),
  user_expressions: Type.Record(Type.String(), Type.String()),
  allow_stdin: Type.Literal(false),
  stop_on_error: Type.Literal(true),
});
export type ExecuteRequestContent = Static<typeof ExecuteRequestContentSchema>;

/** execute_reply content (3-state discriminated union). */
export const ExecuteReplyContentSchema = Type.Union([
  Type.Object({
    status: Type.Literal("ok"),
    execution_count: Type.Integer({ minimum: 1 }),
    payload: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    user_expressions: Type.Record(Type.String(), Type.Unknown()),
  }),
  Type.Object({
    status: Type.Literal("error"),
    execution_count: Type.Integer({ minimum: 1 }),
    ename: Type.String(),
    evalue: Type.String(),
    traceback: Type.Array(Type.String()),
  }),
  Type.Object({
    status: Type.Literal("aborted"),
    execution_count: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
]);
export type ExecuteReplyContent = Static<typeof ExecuteReplyContentSchema>;

/** iopub status message content. */
export const StatusContentSchema = Type.Object({
  execution_state: Type.Union([
    Type.Literal("idle"),
    Type.Literal("busy"),
    Type.Literal("starting"),
  ]),
});
export type StatusContent = Static<typeof StatusContentSchema>;

/** iopub execute_input (echo) content. */
export const ExecuteInputContentSchema = Type.Object({
  code: Type.String(),
  execution_count: Type.Integer({ minimum: 1 }),
});
export type ExecuteInputContent = Static<typeof ExecuteInputContentSchema>;

/** iopub stream content. */
export const StreamContentSchema = Type.Object({
  name: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
  text: Type.String(),
});
export type StreamContent = Static<typeof StreamContentSchema>;

/** iopub display_data content. */
export const DisplayDataContentSchema = Type.Object({
  data: Type.Record(Type.String(), Type.Unknown()),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  transient: Type.Optional(Type.Object({
    display_id: Type.Optional(Type.String()),
  })),
});
export type DisplayDataContent = Static<typeof DisplayDataContentSchema>;

/** iopub execute_result content. */
export const ExecuteResultContentSchema = Type.Object({
  execution_count: Type.Integer({ minimum: 1 }),
  data: Type.Record(Type.String(), Type.Unknown()),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type ExecuteResultContent = Static<typeof ExecuteResultContentSchema>;

/** iopub error content. */
export const ErrorContentSchema = Type.Object({
  ename: Type.String(),
  evalue: Type.String(),
  traceback: Type.Array(Type.String()),
});
export type ErrorContent = Static<typeof ErrorContentSchema>;

/**
 * comm_open content schema.
 *
 * Lenient validation: additionalProperties pass through unchanged so that
 * framework-specific keys such as ipywidgets' `state` / `buffer_paths` reach
 * the registered handler untouched. Strict validation would break interop
 * with widget frameworks whose payload shape sits outside Europa's
 * protocol-transport responsibility.
 */
export const CommOpenContentSchema = Type.Object({
  comm_id: Type.String({ minLength: 1 }),
  target_name: Type.String({ minLength: 1 }),
  target_module: Type.Optional(Type.String({ minLength: 1 })),
  data: Type.Record(Type.String(), Type.Unknown()),
});
export type CommOpenContent = Static<typeof CommOpenContentSchema>;

/** comm_msg content schema (lenient — see CommOpenContentSchema rationale). */
export const CommMsgContentSchema = Type.Object({
  comm_id: Type.String({ minLength: 1 }),
  data: Type.Record(Type.String(), Type.Unknown()),
});
export type CommMsgContent = Static<typeof CommMsgContentSchema>;

/** comm_close content schema. Empty `data: {}` is allowed (Jupyter Client Messaging Spec §10.3). */
export const CommCloseContentSchema = Type.Object({
  comm_id: Type.String({ minLength: 1 }),
  data: Type.Record(Type.String(), Type.Unknown()),
});
export type CommCloseContent = Static<typeof CommCloseContentSchema>;
