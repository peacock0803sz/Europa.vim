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
  id: Type.String(),
  name: Type.String(),
  state: KernelStateSchema,
});
export type KernelInfo = Static<typeof KernelInfoSchema>;

export const SessionSchema = Type.Object({
  bufnr: Type.Integer({ minimum: 0 }),
  notebookPath: Type.String(),
  notebook: NotebookSchema,
  kernel: Type.Optional(KernelInfoSchema),
});
export type Session = Static<typeof SessionSchema>;
