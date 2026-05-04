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
