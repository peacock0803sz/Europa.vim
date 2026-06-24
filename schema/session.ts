/**
 * TypeBox schema for Session, KernelInfo, KernelStatusReport, and ServerHandle.
 *
 * This module is the Source of Truth (SoT 1) for session-related types.
 * Phase 3.2 fully implements KernelInfoSchema (reserved in Phase 2),
 * and adds KernelStatusReportSchema + ServerHandleSchema.
 * The `SessionRuntime` augment type lives in `contracts/session-runtime.ts`.
 *
 * @module schema/session
 */

import { type Static, Type } from "@sinclair/typebox";
import { NotebookSchema } from "./notebook.ts";
import { LanguageInfoSchema } from "./message.ts";

/** Phase 3.2 kernel connection state (5 values). */
export const KernelStateSchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("idle"),
  Type.Literal("busy"),
  Type.Literal("reconnecting"),
  Type.Literal("disconnected"),
]);
export type KernelState = Static<typeof KernelStateSchema>;

/** Full Phase 3.2 KernelInfo (replaces the Phase 2 reserved placeholder). */
export const KernelInfoSchema = Type.Object({
  kernelId: Type.String(),
  sessionId: Type.String(),
  kernelName: Type.String(),
  connectionMode: Type.Union([
    Type.Literal("server"),
    Type.Literal("zmq"),
  ]),
  state: KernelStateSchema,
  subprotocol: Type.Union([
    Type.Literal("v1"),
    Type.Literal("default"),
    // ZMQ attach has no WebSocket subprotocol negotiation; transport dispatch
    // keys off connectionMode === 'zmq', never off subprotocol (D3).
    Type.Literal("none"),
  ]),
  subprocessPid: Type.Optional(Type.Integer()),
  startedAt: Type.String(),
  languageInfo: Type.Optional(LanguageInfoSchema),
  banner: Type.Optional(Type.String()),
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
  cellEditBuffers: Type.Optional(
    Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  ),
});
export type Session = Static<typeof SessionSchema>;

/**
 * Provenance of a single mirror line, used by write-back to de-normalize
 * (FR-012d). "content" = verbatim cell source line; "marker" = the
 * `# %% <cellId>` boundary comment; "header" = the inline suppression header
 * at the mirror top; { kind: "magic", original } = a notebook-only line (line
 * magic `%...` / shell `!...` / help `...?` / a cell-magic body line) that was
 * commented out, remembering the original text for reversal.
 */
export const LineProvenanceSchema = Type.Union([
  Type.Literal("content"),
  Type.Literal("marker"),
  Type.Literal("header"),
  Type.Object({
    kind: Type.Literal("magic"),
    original: Type.String(),
  }),
]);
export type LineProvenance = Static<typeof LineProvenanceSchema>;

/** One code cell's region inside the mirror (0-based mirror line indices). */
export const CellRegionSchema = Type.Object({
  cellId: Type.String(),
  markerLine: Type.Integer({ minimum: 0 }), // index of the `# %% <cellId>` marker
  startLine: Type.Integer({ minimum: 0 }), // first content line (markerLine + 1)
  endLine: Type.Integer({ minimum: 0 }), // last content line (inclusive; == startLine for an empty cell)
});
export type CellRegion = Static<typeof CellRegionSchema>;

/**
 * Runtime state for one notebook's on-disk `.py` mirror (Phase 3.9). Held on
 * SessionRuntime (NOT serialized — never reaches notebook/serialize.ts,
 * FR-016). Regenerated wholesale on every Europa-side notebook mutation
 * (research.md §8). Cleanup deletes `mirrorPath` / `mirrorDir` only, never
 * `workspaceRoot` (FR-018, research.md §9).
 */
export const LspMirrorStateSchema = Type.Object({
  mirrorPath: Type.String({ minLength: 1 }), // real on-disk `.py` path (= buffer name)
  workspaceRoot: Type.String({ minLength: 1 }), // project root (or $XDG_CACHE_HOME fallback); never deleted
  mirrorDir: Type.String({ minLength: 1 }), // dedicated `.europa/lsp/` (or cache) dir — the cleanup unit
  cellRegions: Type.Array(CellRegionSchema),
  lineProvenance: Type.Array(LineProvenanceSchema), // length == mirror line count
  // Buffer number of the opened mirror buffer. A mirror and a 004 scratch can
  // coexist (g:europa_lsp_enable is re-read per editCell), so save / wipeout
  // handlers gate the mirror path on THIS buffer, not on state presence.
  mirrorBufnr: Type.Optional(Type.Integer({ minimum: 1 })),
  // True when a notebook mutation regenerated the mirror while the open
  // buffer held unsaved edits (its reload was skipped): the buffer's lines no
  // longer match cellRegions/lineProvenance, so a :w from it must be refused
  // until the user reloads it from disk (BufReadPost clears the flag).
  bufferStale: Type.Optional(Type.Boolean()),
});
export type LspMirrorState = Static<typeof LspMirrorStateSchema>;

/** Reverse-lookup result from `SessionStore.findViewerByScratchBufnr`. */
export const ScratchLookupSchema = Type.Object({
  viewerBufnr: Type.Integer({ minimum: 0 }),
  cellId: Type.String(),
});
export type ScratchLookup = Static<typeof ScratchLookupSchema>;

/** Returned by `:EuropaKernelStatus` dispatcher method. */
export const KernelStatusReportSchema = Type.Object({
  info: Type.Union([KernelInfoSchema, Type.Null()]),
  wsState: Type.Union([
    Type.Literal("OPEN"),
    Type.Literal("CONNECTING"),
    Type.Literal("CLOSING"),
    Type.Literal("CLOSED"),
    Type.Literal("NONE"),
  ]),
  reconnect: Type.Optional(
    Type.Object({
      retry: Type.Integer(),
      max: Type.Integer(),
    }),
  ),
  uptimeSeconds: Type.Optional(Type.Integer()),
  serverRefcount: Type.Optional(Type.Integer()),
});
export type KernelStatusReport = Static<typeof KernelStatusReportSchema>;

// ---------------------------------------------------------------------------
// Phase 3.3: pendingRequests / execState / cellStates (additive, SoT 1)
// ---------------------------------------------------------------------------

/** One in-flight execute request tracked by the pendingRequests Map. */
export const PendingRequestEntrySchema = Type.Object({
  msgId: Type.String(),
  bufnr: Type.Integer({ minimum: 1 }),
  cellId: Type.String(),
  state: Type.Union([Type.Literal("queued"), Type.Literal("sent")]),
  enqueuedAt: Type.Number(),
  sentAt: Type.Union([Type.Number(), Type.Null()]),
});
export type PendingRequestEntry = Static<typeof PendingRequestEntrySchema>;

/** Per-cell execution state (idle/queued/busy/aborted). */
export const CellExecStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("queued"),
  Type.Literal("busy"),
  Type.Literal("aborted"),
]);
export type CellExecState = Static<typeof CellExecStateSchema>;

/** Kernel-level execution state (5 values). */
export const KernelExecStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("busy"),
  Type.Literal("queued"),
  Type.Literal("restarting"),
  Type.Literal("disconnected"),
]);
export type KernelExecState = Static<typeof KernelExecStateSchema>;

/** ServerPool handle — TypeBox SoT for the serializable subset of ServerHandle. */
export const ServerHandleSchema = Type.Object({
  serverKey: Type.String(),
  pid: Type.Optional(Type.Integer()),
  port: Type.Integer(),
  token: Type.String(),
  url: Type.String(),
  refcount: Type.Integer({ minimum: 0 }),
  watchdogPid: Type.Optional(Type.Integer()),
});
export type ServerHandle = Static<typeof ServerHandleSchema>;
