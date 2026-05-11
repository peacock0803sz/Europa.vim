/**
 * TypeBox schema for host capabilities and image protocol detection.
 *
 * This module is the Source of Truth (SoT 1) for Capabilities types.
 *
 * @module schema/capabilities
 */

import { type Static, Type } from "@sinclair/typebox";

export const HostKindSchema = Type.Union([
  Type.Literal("vim"),
  Type.Literal("nvim"),
]);
export type HostKind = Static<typeof HostKindSchema>;

export const ImageProtocolSchema = Type.Union([
  Type.Literal("placeholder"),
  Type.Literal("sixel"),
  Type.Literal("kitty_placeholder"),
  Type.Literal("iterm2_osc1337"),
]);
export type ImageProtocol = Static<typeof ImageProtocolSchema>;

/** tree-sitter runtime availability for the current host. */
export const TreeSitterCapabilitySchema = Type.Object({
  available: Type.Boolean(),
});
export type TreeSitterCapability = Static<typeof TreeSitterCapabilitySchema>;

export const CapabilitiesSchema = Type.Object({
  host: HostKindSchema,
  hostVersion: Type.String(),
  image: ImageProtocolSchema,
  treeSitter: TreeSitterCapabilitySchema,
});
export type Capabilities = Static<typeof CapabilitiesSchema>;
