/**
 * I/O layer for the notebook mirror: placement resolution, on-disk
 * materialize, and cleanup (Phase 3.9).
 *
 * Resolves where a notebook's mirror lives so a user's LSP client picks the
 * right workspace root (and thus the project's venv + pyright/ruff config):
 * the nearest ancestor of the `.ipynb` containing a root marker, else the
 * `.ipynb`'s own directory; an unsaved notebook falls back to a per-session
 * cache directory (FR-003 / research §1).
 *
 * Cleanup is deliberately split so it can NEVER delete the user's project root
 * (`workspaceRoot`): `cleanupMirrorFile` removes just the mirror `.py`, and
 * `cleanupMirrorDir` removes only the dedicated `.europa/lsp/` (or cache)
 * directory (FR-018 / research §9).
 *
 * @module denops/europa/lsp/workspace
 */

import { basename } from "@std/path/basename";
import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";
import { resolve } from "@std/path/resolve";
import { ensureDir } from "@std/fs";
import { exists } from "@std/fs/exists";

/** Markers that identify a Python project root for LSP `root_dir` detection. */
const ROOT_MARKERS: readonly string[] = [
  "pyrightconfig.json",
  "pyproject.toml",
  ".git",
  ".venv",
];

/** Walk upward from `startDir` to the nearest ancestor holding a root marker. */
async function findProjectRoot(
  startDir: string,
): Promise<string | undefined> {
  let dir = resolve(startDir);
  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (await exists(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
}

/** Resolved on-disk placement for a notebook's mirror. */
export async function resolveMirrorPlacement(
  notebookPath?: string,
): Promise<{ mirrorPath: string; workspaceRoot: string; mirrorDir: string }> {
  if (notebookPath && notebookPath !== "") {
    const notebookDir = dirname(notebookPath);
    const workspaceRoot = (await findProjectRoot(notebookDir)) ??
      resolve(notebookDir);
    const mirrorDir = join(workspaceRoot, ".europa", "lsp");
    const stem = basename(notebookPath).replace(/\.ipynb$/, "");
    return {
      mirrorPath: join(mirrorDir, `${stem}.py`),
      workspaceRoot,
      mirrorDir,
    };
  }
  // Unsaved notebook: isolate in a per-session cache dir (XDG, ~/.cache fallback).
  const cacheBase = Deno.env.get("XDG_CACHE_HOME") ??
    join(Deno.env.get("HOME") ?? ".", ".cache");
  const mirrorDir = join(cacheBase, "europa", "lsp", crypto.randomUUID());
  // For an unsaved notebook the mirror dir IS the workspace root (nothing else
  // to anchor to); cleanup still only ever removes mirrorDir, never a parent.
  return {
    mirrorPath: join(mirrorDir, "mirror.py"),
    workspaceRoot: mirrorDir,
    mirrorDir,
  };
}

/** Write the mirror text to disk, creating the mirror dir if needed. */
export async function materializeMirror(
  mirrorPath: string,
  text: string,
): Promise<void> {
  await ensureDir(dirname(mirrorPath));
  await Deno.writeTextFile(mirrorPath, text);
}

/** Remove just the mirror `.py` file (BufWipeout). Never touches a directory. */
export async function cleanupMirrorFile(mirrorPath: string): Promise<void> {
  try {
    await Deno.remove(mirrorPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/**
 * Remove the dedicated mirror directory (process exit). The caller passes
 * `lspMirror.mirrorDir` (`.europa/lsp/` or the cache dir) — NEVER
 * `workspaceRoot` — so the user's project is never deleted (FR-018).
 */
export async function cleanupMirrorDir(mirrorDir: string): Promise<void> {
  try {
    await Deno.remove(mirrorDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
