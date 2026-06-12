/**
 * Spec for the notebook-mirror I/O layer (Phase 3.9).
 *
 * Pins the safety-critical invariant from the design review: cleanup removes
 * only the mirror file / mirror dir and NEVER the workspace (project) root
 * (FR-018, research §9), plus basic placement + materialize behaviour.
 *
 * @module tests/spec/lsp/workspace_spec
 */

import { assert, assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { dirname, join, relative } from "@std/path";
import {
  cleanupMirrorDir,
  cleanupMirrorFile,
  cleanupMirrorOnExit,
  materializeMirror,
  resolveMirrorPlacement,
} from "../../../denops/europa/lsp/workspace.ts";

describe("resolveMirrorPlacement + cleanup safety", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-ws-" });
  });
  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  it("places the mirror under <project-root>/.europa/lsp and detects the root marker", async () => {
    // tmp/ is the project root (pyproject.toml); the notebook lives in a subdir.
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
    const subdir = join(tmp, "nb");
    await Deno.mkdir(subdir);
    const notebookPath = join(subdir, "demo.ipynb");

    const { mirrorPath, workspaceRoot, mirrorDir } =
      await resolveMirrorPlacement(
        notebookPath,
      );

    assertEquals(workspaceRoot, tmp); // climbed to the pyproject.toml root
    assertEquals(mirrorDir, join(tmp, ".europa", "lsp"));
    // Workspace-relative slug: nb/demo.ipynb → nb__demo.py (collision-free).
    assertEquals(mirrorPath, join(tmp, ".europa", "lsp", "nb__demo.py"));
    // The mirror dir is strictly inside the workspace root (never equal to it).
    assert(mirrorDir !== workspaceRoot);
  });

  it("derives mirrorDir as <workspaceRoot>/.europa/lsp under the resolved root", async () => {
    const notebookPath = join(tmp, "loose.ipynb");
    const { workspaceRoot, mirrorDir, mirrorPath } =
      await resolveMirrorPlacement(
        notebookPath,
      );
    assertEquals(mirrorDir, join(workspaceRoot, ".europa", "lsp"));
    // The filename is the workspace-relative path slug (`/` → `__`).
    const slug = relative(workspaceRoot, notebookPath)
      .replace(/\.ipynb$/, "")
      .split("/")
      .join("__");
    assertEquals(mirrorPath, join(mirrorDir, `${slug}.py`));
    // workspaceRoot is tmp or a marker-bearing ancestor (FR-003 root detection).
    assert(tmp === workspaceRoot || tmp.startsWith(`${workspaceRoot}/`));
  });

  it("materializes the mirror file and cleanup removes file/dir but NOT the root", async () => {
    await Deno.writeTextFile(join(tmp, ".git"), ""); // root marker
    const notebookPath = join(tmp, "x.ipynb");
    const { mirrorPath, workspaceRoot, mirrorDir } =
      await resolveMirrorPlacement(
        notebookPath,
      );

    await materializeMirror(mirrorPath, "# %% c1\nx = 1\n");
    const stat = await Deno.stat(mirrorPath);
    assert(stat.isFile);

    // cleanupMirrorFile removes the file but leaves the dir + root intact.
    await cleanupMirrorFile(mirrorPath);
    assertEquals(
      await Deno.stat(mirrorPath).then(() => true).catch(() => false),
      false,
    );
    assertEquals(
      await Deno.stat(dirname(mirrorPath)).then(() => true).catch(() => false),
      true,
    );

    // cleanupMirrorDir removes the mirror dir but the workspace root survives.
    await cleanupMirrorDir(mirrorDir);
    assertEquals(
      await Deno.stat(mirrorDir).then(() => true).catch(() => false),
      false,
    );
    assertEquals(
      await Deno.stat(workspaceRoot).then(() => true).catch(() => false),
      true,
    );
  });

  it("disambiguates same-stem notebooks in different subdirs (path slug)", async () => {
    // a/demo.ipynb and b/demo.ipynb share a workspace root; their mirrors
    // must not collide on <root>/.europa/lsp/demo.py.
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
    await Deno.mkdir(join(tmp, "a"));
    await Deno.mkdir(join(tmp, "b"));

    const pa = await resolveMirrorPlacement(join(tmp, "a", "demo.ipynb"));
    const pb = await resolveMirrorPlacement(join(tmp, "b", "demo.ipynb"));

    assert(
      pa.mirrorPath !== pb.mirrorPath,
      "same-stem notebooks must get distinct mirror paths",
    );
    // Both still live in the single shared mirror dir.
    assertEquals(pa.mirrorDir, join(tmp, ".europa", "lsp"));
    assertEquals(pb.mirrorDir, pa.mirrorDir);
  });

  it("cleanup is idempotent (no throw when already gone)", async () => {
    const { mirrorPath, mirrorDir } = await resolveMirrorPlacement(
      join(tmp, "y.ipynb"),
    );
    await cleanupMirrorFile(mirrorPath); // never created
    await cleanupMirrorDir(mirrorDir); // never created
  });
});

describe("cleanupMirrorOnExit", () => {
  // Process-exit cleanup policy: a project-placed mirror removes only its
  // file (the `.europa/lsp/` dir may be shared with other Vim instances /
  // notebooks); an unsaved-notebook mirror removes its whole per-session
  // cache dir (recognizable by workspaceRoot === mirrorDir) so UUID dirs do
  // not accumulate under the cache.
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-exit-" });
  });
  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  it("removes only the mirror file for a project-placed mirror", async () => {
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
    const placement = await resolveMirrorPlacement(join(tmp, "demo.ipynb"));
    await materializeMirror(placement.mirrorPath, "# %% c1\nx = 1\n");

    await cleanupMirrorOnExit(placement);

    assertEquals(
      await Deno.stat(placement.mirrorPath).then(() => true).catch(() => false),
      false,
      "the mirror file must be removed on exit",
    );
    assertEquals(
      await Deno.stat(placement.mirrorDir).then(() => true).catch(() => false),
      true,
      "the shared .europa/lsp dir must survive",
    );
  });

  it("removes the whole per-session cache dir for an unsaved-notebook mirror", async () => {
    // Shape of resolveMirrorPlacement(undefined): workspaceRoot === mirrorDir.
    const mirrorDir = join(tmp, "cache-uuid");
    const placement = {
      mirrorPath: join(mirrorDir, "mirror.py"),
      workspaceRoot: mirrorDir,
      mirrorDir,
    };
    await materializeMirror(placement.mirrorPath, "# %% c1\nx = 1\n");

    await cleanupMirrorOnExit(placement);

    assertEquals(
      await Deno.stat(mirrorDir).then(() => true).catch(() => false),
      false,
      "the per-session cache dir must be removed on exit",
    );
  });
});
