/**
 * Shared mirror-refresh step for dispatcher mutation paths (Phase 3.9).
 *
 * Every Europa-side notebook mutation (cell op, scratch/mirror save, undo /
 * redo) invalidates the mirror's line maps, so the state + on-disk file are
 * regenerated wholesale (research §8) and an open mirror buffer is kept in
 * step. Centralized here so no mutation path can forget the regeneration.
 *
 * @module denops/europa/dispatcher/_mirror
 */

import type { Notebook } from "../../../schema/notebook.ts";
import { buildMirror } from "../lsp/mirror.ts";
import { materializeMirror } from "../lsp/workspace.ts";
import { syncMirrorBuffer } from "../view/viewer.ts";
import type { DispatcherContext } from "./context.ts";

/**
 * Regenerate the mirror state + on-disk file from `notebook` and reload an
 * open mirror buffer. No-op when the session has no materialized mirror.
 *
 * `forceBufferSync` force-replaces the buffer even when it is modified — only
 * valid right after the mirror's own `:w` (its content was just absorbed);
 * otherwise a modified buffer is left untouched with a warning (unsaved edits
 * must never be discarded).
 */
export async function refreshMirror(
  ctx: DispatcherContext,
  bufnr: number,
  notebook: Notebook,
  opts: { forceBufferSync?: boolean } = {},
): Promise<void> {
  const { denops, sessionStore } = ctx;
  const mirror = sessionStore.get(bufnr)?.lspMirror;
  if (!mirror) return;
  const rebuilt = buildMirror(notebook);
  await materializeMirror(mirror.mirrorPath, rebuilt.text);
  sessionStore.update(bufnr, {
    lspMirror: {
      ...mirror,
      cellRegions: [...rebuilt.cellRegions],
      lineProvenance: [...rebuilt.lineProvenance],
    },
  });
  if (mirror.mirrorBufnr !== undefined) {
    await syncMirrorBuffer(
      denops,
      mirror.mirrorBufnr,
      rebuilt.text.split("\n"),
      { force: opts.forceBufferSync },
    );
  }
}
