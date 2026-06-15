import { type Static, Type } from "@sinclair/typebox";

/**
 * TypeBox schema for a standard Jupyter connection file.
 *
 * Source of Truth (SoT 1) for ConnectionFile. The file is written by
 * `jupyter kernel` / ipykernel and read read-only at `:EuropaAttach` time.
 *
 * `transport` and `signature_scheme` are kept as Type.String (NOT Type.Literal)
 * on purpose: the tcp-only / hmac-sha256-only restriction of this slice is a
 * "deferred, not malformed" condition (Q3 / FR-003). A code check after
 * Value.Check distinguishes unsupported transport/scheme from a broken file,
 * so each can be reported with its own EuropaKernelError code. The
 * `europa.kernel.connection-file.*` spec-ids therefore live on the parse impl
 * in `denops/europa/kernel/connection-file.ts`, not here (schema/ is outside
 * the bijection lint's IMPL_ROOTS).
 *
 * @module schema/connection-file
 */
export const ConnectionFileSchema = Type.Object({
  shell_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  iopub_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  stdin_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  control_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  hb_port: Type.Integer({ minimum: 1, maximum: 65535 }),
  ip: Type.String({ minLength: 1 }),
  key: Type.String(), // empty string allowed (unsigned kernel, FR-004)
  transport: Type.String({ minLength: 1 }), // tcp-only enforced post-Value.Check, not as Type.Literal
  signature_scheme: Type.String({ minLength: 1 }), // hmac-sha256-only enforced post-Value.Check
  kernel_name: Type.Optional(Type.String()),
});

export type ConnectionFile = Static<typeof ConnectionFileSchema>;
