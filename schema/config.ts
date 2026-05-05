/**
 * TypeBox schema for Europa configuration options (`g:europa_*`).
 *
 * This module is the Source of Truth (SoT 1) for EuropaConfig.
 * Phase 2 active options are Rendering and Behavior sections.
 * Connection/Kernel options are reserved for Phase 3.
 *
 * @module schema/config
 */

import { type Static, Type } from "@sinclair/typebox";

export const EuropaConfigSchema = Type.Object({
  // Connection (Phase 1 reserve — not read by main.ts in Phase 2)
  connection_mode: Type.Union([
    Type.Literal("server"),
    Type.Literal("zmq"),
    Type.Literal("auto"),
  ], { default: "auto" }),
  jupyter_url: Type.String({ default: "http://localhost:8888" }),
  jupyter_token: Type.String({ default: "" }),
  jupyter_ws_subprotocol: Type.Union([
    Type.Literal("default"),
    Type.Literal("v1"),
    Type.Literal("auto"),
  ], { default: "auto" }),
  default_kernel: Type.String({ default: "python3" }),
  auto_start_kernel: Type.Boolean({ default: false }),
  jupyter_executable: Type.String({ default: "" }),
  python_env_detect: Type.Union([
    Type.Literal("auto"),
    Type.Literal("disabled"),
  ], { default: "auto" }),

  // Rendering (Phase 2 active)
  image_backend: Type.Union([
    Type.Literal("auto"),
    Type.Literal("placeholder"),
    Type.Literal("sixel"),
    Type.Literal("kitty_placeholder"),
    Type.Literal("iterm2_osc1337"),
  ], { default: "auto" }),
  mime_priority: Type.Array(Type.String(), {
    default: ["image/png", "image/jpeg", "text/html", "text/plain"],
  }),
  max_output_lines: Type.Integer({ minimum: 1, default: 100 }),
  cell_border_chars: Type.Array(
    Type.String({ minLength: 1, pattern: "^[^/\n\r\x00]+$" }),
    { default: ["╭", "─", "╮", "╰", "╯"], minItems: 5, maxItems: 5 },
  ),
  cell_border_padding: Type.Integer({ minimum: 0, default: 4 }),
  cell_border_align: Type.Union(
    [Type.Literal("center"), Type.Literal("left")],
    { default: "left" },
  ),
  lazy_padding: Type.Integer({ minimum: 0, default: 10 }),

  // Behavior (Phase 2 active)
  auto_save: Type.Boolean({ default: false }),
  use_subprocess: Type.Boolean({ default: true }),

  // Phase 3.2: WebSocket reconnect options (Q3)
  wsReconnectMaxRetries: Type.Integer({ default: 5, minimum: 0, maximum: 20 }),
  wsReconnectInitialIntervalMs: Type.Integer({
    default: 1000,
    minimum: 100,
    maximum: 30000,
  }),
  wsReconnectMultiplier: Type.Number({
    default: 2.0,
    minimum: 1.0,
    maximum: 4.0,
  }),
});

export type EuropaConfig = Static<typeof EuropaConfigSchema>;
