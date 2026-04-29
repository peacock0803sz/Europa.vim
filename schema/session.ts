/**
 * TypeBox schema for Session, KernelInfo, and KernelState.
 *
 * This module is the Source of Truth (SoT 1) for session-related types.
 * In Phase 2 the kernel-related fields are reserved but not active.
 * The `SessionRuntime` augment type lives in `contracts/session-runtime.ts`.
 *
 * @module schema/session
 */

import { type Static, Type } from "@sinclair/typebox";
import { NotebookSchema } from "./notebook.ts";

export const KernelStateSchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("idle"),
  Type.Literal("busy"),
  Type.Literal("dead"),
]);
export type KernelState = Static<typeof KernelStateSchema>;

export const KernelInfoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  state: KernelStateSchema,
});
export type KernelInfo = Static<typeof KernelInfoSchema>;

export const CellMapEntrySchema = Type.Object({
  cellIndex: Type.Integer({ minimum: 0 }),
  bufLineStart: Type.Integer({ minimum: 0 }),
  bufLineEnd: Type.Integer({ minimum: 0 }),
});
export type CellMapEntry = Static<typeof CellMapEntrySchema>;

export const SessionSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  bufnr: Type.Integer({ minimum: 0 }),
  notebookPath: Type.String(),
  notebook: NotebookSchema,
  kernel: Type.Optional(KernelInfoSchema),
  cellMap: Type.Array(CellMapEntrySchema),
});
export type Session = Static<typeof SessionSchema>;
