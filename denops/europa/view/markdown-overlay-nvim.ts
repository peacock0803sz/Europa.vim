/**
 * Neovim-only markdown inline overlay application.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import { batch, collect } from "@denops/std/batch";
import type {
  MdDecoration,
  MdOverlayViewport,
} from "../../../contracts/markdown-renderer.ts";

let ns: number | null = null;
const registry = new Map<number, Map<string, number>>();

function decorationKey(decoration: MdDecoration): string {
  return [
    decoration.line,
    decoration.colStart,
    decoration.colEnd,
    decoration.hlGroup ?? "",
    decoration.conceal ?? "",
    decoration.virtText ?? "",
    decoration.virtTextHlGroup ?? "",
    decoration.hlEol ?? false,
  ].join(":");
}

function inViewport(
  decoration: MdDecoration,
  viewport: MdOverlayViewport,
): boolean {
  const line = decoration.line + 1;
  return line >= viewport.top - 10 && line <= viewport.bottom + 10;
}

async function isNvim(denops: Denops): Promise<boolean> {
  return await denops.call("has", "nvim") === 1 || denops.meta.host === "nvim";
}

async function ensureNamespace(denops: Denops): Promise<number> {
  if (ns !== null) return ns;
  ns = await denops.call("nvim_create_namespace", "EuropaMdOverlay") as number;
  return ns;
}

function bufferRegistry(bufnr: number): Map<string, number> {
  const marks = registry.get(bufnr);
  if (marks) return marks;
  const next = new Map<string, number>();
  registry.set(bufnr, next);
  return next;
}

function buildExtmarkOpts(decoration: MdDecoration): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    end_col: decoration.colEnd,
    virt_text_pos: "inline",
  };
  if (decoration.conceal !== undefined) opts.conceal = decoration.conceal;
  if (decoration.virtText !== undefined) {
    opts.virt_text = [[decoration.virtText, decoration.virtTextHlGroup ?? ""]];
  } else {
    delete opts.virt_text_pos;
  }
  if (decoration.hlGroup !== undefined) opts.hl_group = decoration.hlGroup;
  if (decoration.hlEol !== undefined) opts.hl_eol = decoration.hlEol;
  return opts;
}

async function applyDecorationsBatched(
  denops: Denops,
  bufnr: number,
  nsId: number,
  decorations: readonly MdDecoration[],
): Promise<void> {
  if (decorations.length === 0) return;
  const marks = bufferRegistry(bufnr);

  const toDelIds: number[] = [];
  for (const decoration of decorations) {
    const existing = marks.get(decorationKey(decoration));
    if (existing !== undefined) toDelIds.push(existing);
  }
  if (toDelIds.length > 0) {
    await batch(denops, async (helper) => {
      for (const id of toDelIds) {
        await helper.call("nvim_buf_del_extmark", bufnr, nsId, id);
      }
    });
  }

  const ids = await collect(
    denops,
    (helper) =>
      decorations.map((decoration) =>
        helper.call(
          "nvim_buf_set_extmark",
          bufnr,
          nsId,
          decoration.line,
          decoration.colStart,
          buildExtmarkOpts(decoration),
        )
      ),
  );
  for (let i = 0; i < decorations.length; i++) {
    marks.set(decorationKey(decorations[i]), ids[i] as number);
  }
}

async function removeDecorationsBatched(
  denops: Denops,
  bufnr: number,
  nsId: number,
  decorations: readonly MdDecoration[],
): Promise<void> {
  if (decorations.length === 0) return;
  const marks = registry.get(bufnr);
  if (!marks) return;

  const targets: { key: string; id: number }[] = [];
  for (const decoration of decorations) {
    const key = decorationKey(decoration);
    const id = marks.get(key);
    if (id !== undefined) targets.push({ key, id });
  }
  if (targets.length === 0) return;

  await batch(denops, async (helper) => {
    for (const { id } of targets) {
      await helper.call("nvim_buf_del_extmark", bufnr, nsId, id);
    }
  });
  for (const { key } of targets) marks.delete(key);
}

/**
 * Apply markdown overlay decorations for the current viewport.
 *
 * @spec-id europa.render.markdown.viewport-gating
 */
export async function applyMdDecorations(
  denops: Denops,
  bufnr: number,
  decorations: readonly MdDecoration[],
  viewport: MdOverlayViewport,
): Promise<void> {
  // Defensive: host detection happens in viewer.ts, but this guard prevents accidental Vim invocation.
  if (!await isNvim(denops)) return;
  const nsId = await ensureNamespace(denops);
  const inRange = decorations.filter((decoration) =>
    inViewport(decoration, viewport)
  );
  await applyDecorationsBatched(denops, bufnr, nsId, inRange);
}

/**
 * Update markdown overlay extmarks after the viewport changes.
 */
export async function onViewportScrolled(
  denops: Denops,
  bufnr: number,
  decorations: readonly MdDecoration[],
  oldViewport: MdOverlayViewport,
  newViewport: MdOverlayViewport,
): Promise<void> {
  // Defensive: host detection happens in viewer.ts, but this guard prevents accidental Vim invocation.
  if (!await isNvim(denops)) return;
  const nsId = await ensureNamespace(denops);
  const toRemove = decorations.filter((decoration) =>
    inViewport(decoration, oldViewport) && !inViewport(decoration, newViewport)
  );
  const toAdd = decorations.filter((decoration) =>
    !inViewport(decoration, oldViewport) && inViewport(decoration, newViewport)
  );

  await removeDecorationsBatched(denops, bufnr, nsId, toRemove);
  await applyDecorationsBatched(denops, bufnr, nsId, toAdd);
}

/**
 * Clear all markdown overlay extmarks in the buffer.
 */
export async function clearMdOverlay(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  // Defensive: host detection happens in viewer.ts, but this guard prevents accidental Vim invocation.
  if (!await isNvim(denops)) return;
  if (ns !== null) {
    await denops.call("nvim_buf_clear_namespace", bufnr, ns, 0, -1);
  }
  registry.delete(bufnr);
}

/**
 * Configure buffer-local conceal settings for markdown overlays.
 *
 * @spec-id europa.render.markdown.cursor-line-conceal
 */
export async function ensureMdOverlayBufferOptions(
  denops: Denops,
  bufnr: number,
): Promise<void> {
  // Defensive: host detection happens in viewer.ts, but this guard prevents accidental Vim invocation.
  if (!await isNvim(denops)) return;
  await denops.call("setbufvar", bufnr, "&conceallevel", 2);
  await denops.call("setbufvar", bufnr, "&concealcursor", "");
}

export function __resetMdOverlayForTest(): void {
  ns = null;
  registry.clear();
}
