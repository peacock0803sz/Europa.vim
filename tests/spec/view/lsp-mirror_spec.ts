/**
 * Integration spec for the LSP notebook-mirror edit path (Phase 3.9, US1).
 *
 * Drives the real dispatcher over a MockHost and a temp-dir notebook, asserting
 * that `:EuropaEditCell` on a python notebook opens an on-disk `.py` mirror
 * buffer (ft=python) under the workspace `.europa/lsp/` rather than the 004
 * scratch, and that `g:europa_lsp_enable=false` falls back to the scratch
 * (SC-001 / SC-002 / SC-003). Real-LSP attach is verified in the conformance
 * tier.
 *
 * @module tests/spec/view/lsp-mirror_spec
 * @spec-id europa.view.lsp.edit-cell-region
 * @spec-id europa.dispatcher.mirror-reloaded
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path/join";
import { buildDispatcher } from "../../../denops/europa/main.ts";
import { loadConfig } from "../../../denops/europa/config.ts";
import { mockVim } from "../../fixtures/mock-host.ts";
import type { MockHost } from "../../fixtures/mock-host.ts";

const VIEWER_BUFNR = 1;
const CELL_ID = "lsp-type-error-1";

describe("LSP mirror edit path (US1)", () => {
  let host: MockHost;
  let tmp: string;
  let notebookPath: string;

  beforeEach(async () => {
    host = mockVim();
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-mirror-" });
    // Plant a project-root marker so mirror placement is deterministic (tmp).
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
    notebookPath = join(tmp, "demo.ipynb");
    const fixture = await Deno.readTextFile(
      new URL("../../fixtures/ipynb/lsp-type-error.ipynb", import.meta.url),
    );
    await Deno.writeTextFile(notebookPath, fixture);
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  it("(a) opens a real .py mirror buffer with ft=python, not a scratch (SC-001)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);

    const bufadds = host.callsTo("bufadd").map((c) => String(c.args[1]));
    const mirrorAdd = bufadds.find(
      (n) => n.endsWith(".py") && n.includes(join(".europa", "lsp")),
    );
    assertExists(mirrorAdd); // a real .py mirror path was opened
    assert(
      !bufadds.some((n) => n.includes("__europa_cell_")),
      "must not open the 004 scratch buffer",
    );
    const ftPython = host.callsTo("setbufvar").some(
      (c) => c.args[2] === "&filetype" && c.args[3] === "python",
    );
    assert(ftPython, "mirror buffer filetype must be python");
  });

  it("(b) materializes the mirror under <workspaceRoot>/.europa/lsp (SC-002)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);

    assertEquals(await exists(join(tmp, ".europa", "lsp", "demo.py")), true);
  });

  it("(c) g:europa_lsp_enable=false falls back to the 004 scratch (SC-003)", async () => {
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);

    const bufadds = host.callsTo("bufadd").map((c) => String(c.args[1]));
    assert(
      bufadds.some((n) => n.includes(`__europa_cell_${CELL_ID}__`)),
      "must open the 004 scratch buffer when LSP is disabled",
    );
    assertEquals(
      await exists(join(tmp, ".europa", "lsp", "demo.py")),
      false,
      "no mirror is materialized when LSP is disabled",
    );
  });

  it("(d) regenerates the mirror after a 004 cell op (FR-011 / US3)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID); // materialize (1 cell)
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const before = (await Deno.readTextFile(mirrorFile)).match(/^# %% /gm) ??
      [];
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", CELL_ID);
    const after = (await Deno.readTextFile(mirrorFile)).match(/^# %% /gm) ?? [];
    assertEquals(after.length, before.length + 1); // new cell reflected
  });

  it("(d2) reloads an UNMODIFIED open mirror buffer after a cell op", async () => {
    // The on-disk regeneration alone would leave the open buffer stale: the
    // next :w would distribute outdated lines and Vim would warn (W11).
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    assert(mirrorBufnr > 0);

    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", CELL_ID);

    const markers = host.getBufLines(mirrorBufnr)
      .filter((l) => l.startsWith("# %% "));
    assertEquals(markers.length, 2, "buffer must show the regenerated mirror");
  });

  it("(d3) leaves a MODIFIED mirror buffer untouched and warns instead", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    await host.call("setbufline", mirrorBufnr, 1, ["my unsaved edit"]);
    await host.call("setbufvar", mirrorBufnr, "&modified", 1);
    const editedLines = host.getBufLines(mirrorBufnr).slice();
    host.calls = [];

    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", CELL_ID);

    assertEquals(
      host.getBufLines(mirrorBufnr),
      editedLines,
      "unsaved mirror edits must never be discarded",
    );
    assert(
      host.cmdsMatching("unsaved edits").length > 0,
      "the user must be warned that the mirror buffer is stale",
    );
  });

  it("(d4) saving the mirror re-normalizes the buffer (newly typed magic line)", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    // Type an UNcommented magic line at the end of the loaded buffer.
    await host.call("appendbufline", mirrorBufnr, "$", "%timeit x");

    await dispatcher.saveCellEdit(mirrorBufnr);

    assert(
      host.getBufLines(mirrorBufnr).includes("# %timeit x"),
      "after :w the buffer must show the regenerated (normalized) mirror",
    );
  });

  it("(e) a no-op :w right after open preserves trailing newline + magic (FR-016)", async () => {
    // The on-disk mirror ends with one terminating "\n" that Vim reads as the
    // last line's EOL — the loaded buffer must still map 1:1 to the build, or
    // an untouched save drops the last cell's trailing newline and commits
    // its magic line in commented form.
    const nb = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: "python" } },
      cells: [{
        cell_type: "code",
        id: "tn1",
        source: "%timeit f()\nx = 1\n",
        execution_count: null,
        outputs: [],
        metadata: {},
      }],
    });
    const path = join(tmp, "trailing.ipynb");
    await Deno.writeTextFile(path, nb);
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, path);
    await dispatcher.editCell(VIEWER_BUFNR, "tn1");
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "trailing.py"),
    ) as number;
    assert(mirrorBufnr > 0);

    await dispatcher.saveCellEdit(mirrorBufnr);
    assertEquals(
      await host.call("getbufvar", VIEWER_BUFNR, "&modified", 0),
      0,
      "a no-op mirror save must not dirty the viewer",
    );
    await dispatcher.save(VIEWER_BUFNR);

    const saved = JSON.parse(await Deno.readTextFile(path));
    const source = Array.isArray(saved.cells[0].source)
      ? saved.cells[0].source.join("")
      : saved.cells[0].source;
    assertEquals(source, "%timeit f()\nx = 1\n");
  });

  it("(f) re-focusing an open mirror reuses the tracked bufnr, not a name lookup", async () => {
    // bufnr("<path>") is a file-PATTERN lookup: wildcards in the path break
    // it and substring matches can resolve to an UNRELATED buffer that would
    // then receive the mirror autocmds. The dispatcher must reuse the bufnr
    // tracked in lspMirror state instead.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    host.calls = [];

    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);

    assert(
      host.callsTo("bufnr").every((c) => typeof c.args[1] !== "string"),
      "must not look the mirror buffer up by name",
    );
    assertEquals(
      host.callsTo("bufadd").length,
      0,
      "the already-open mirror buffer must be reused",
    );
  });

  it("(g) :EuropaUndo of a cell op regenerates the mirror (file + buffer)", async () => {
    // Undo restores the notebook like any other structural mutation; without
    // regeneration the on-disk mirror, the open buffer, and the line maps all
    // stay at the pre-undo state, and the next mirror :w silently re-applies
    // the undone change.
    const countMarkers = (text: string) =>
      (text.match(/^# %% /gm) ?? []).length;
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", CELL_ID);
    assertEquals(countMarkers(await Deno.readTextFile(mirrorFile)), 2);

    await dispatcher.europaUndo(VIEWER_BUFNR);
    await new Promise((r) => setTimeout(r, 80)); // drain the undo FIFO

    assertEquals(
      countMarkers(await Deno.readTextFile(mirrorFile)),
      1,
      "the on-disk mirror must reflect the undone notebook",
    );
    assertEquals(
      host.getBufLines(mirrorBufnr).filter((l) => l.startsWith("# %% "))
        .length,
      1,
      "the open mirror buffer must reflect the undone notebook",
    );
  });

  it("(i) re-opening the viewer (:e) tears the old session's mirror down", async () => {
    // BufReadCmd re-fires open() for an already-open session; replacing it
    // without teardown leaks the on-disk mirror forever (the new session has
    // no lspMirror) and leaves an orphaned mirror buffer whose stale content
    // could be re-adopted later with the stale guard unset.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    assertEquals(await exists(mirrorFile), true);

    await dispatcher.open(VIEWER_BUFNR, notebookPath); // :e reload

    assertEquals(
      await exists(mirrorFile),
      false,
      "the previous session's mirror file must be cleaned up on reload",
    );
  });

  it("(h0) refuses a mirror :w when every cell marker is gone", async () => {
    // ggdG + rewrite leaves no `# %% <id>` markers: distributing yields zero
    // blocks, which must not be confused with a clean no-op save — Vim would
    // report success while the buffer content is silently ignored.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;
    const total = host.getBufLines(mirrorBufnr).length;
    await host.call("setbufline", mirrorBufnr, 1, ["x = 1"]);
    await host.call("deletebufline", mirrorBufnr, 2, total);
    await host.call("setbufvar", mirrorBufnr, "&modified", 1);
    host.calls = [];

    await dispatcher.saveCellEdit(mirrorBufnr);

    assert(
      host.cmdsMatching("marker").length > 0,
      "the markerless save must be refused with an explanation",
    );
    assertEquals(
      await host.call("getbufvar", mirrorBufnr, "&modified"),
      1,
      "the buffer must stay modified so the content is not presumed saved",
    );
  });

  it("(h) refuses a mirror :w from a stale buffer until it is reloaded", async () => {
    // When a structural op regenerates the mirror while the buffer holds
    // unsaved edits, the buffer keeps the OLD cell layout: distributing it
    // against the new regions would merge a deleted/changed cell's lines into
    // a neighbour. Such a save must be refused, not silently corrupted.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, notebookPath);
    await dispatcher.editCell(VIEWER_BUFNR, CELL_ID);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    // Unsaved edits in the mirror ...
    await host.call("appendbufline", mirrorBufnr, "$", "tainted = 1");
    await host.call("setbufvar", mirrorBufnr, "&modified", 1);
    // ... then a structural op regenerates the mirror (buffer sync skipped).
    await dispatcher.insertCell(VIEWER_BUFNR, "code", "after", CELL_ID);

    host.calls = [];
    await dispatcher.saveCellEdit(mirrorBufnr);

    assert(
      host.cmdsMatching("out of sync").length > 0,
      "the stale save must be refused with an explanation",
    );
    assert(
      !host.getBufLines(VIEWER_BUFNR).some((l) => l.includes("tainted")),
      "the stale buffer's lines must not reach the notebook",
    );

    // Reloading from disk (:e! → BufReadPost → mirrorReloaded) resyncs.
    const text = await Deno.readTextFile(mirrorFile);
    const reloaded = text.endsWith("\n")
      ? text.slice(0, -1).split("\n")
      : text.split("\n");
    await host.call("setbufline", mirrorBufnr, 1, reloaded);
    await host.call("deletebufline", mirrorBufnr, reloaded.length + 1, "$");
    await host.call("setbufvar", mirrorBufnr, "&modified", 0);
    await dispatcher.mirrorReloaded(mirrorBufnr);

    host.calls = [];
    await dispatcher.saveCellEdit(mirrorBufnr);
    assertEquals(
      host.cmdsMatching("out of sync").length,
      0,
      "a reloaded mirror buffer must save normally again",
    );
  });
});

describe("LSP enablement matrix (US5)", () => {
  let host: MockHost;
  let tmp: string;

  beforeEach(async () => {
    host = mockVim();
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-us5-" });
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
  });
  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  it("'auto' on a non-python notebook falls back to the scratch (US5 AC2)", async () => {
    const rNotebook = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: "r" } },
      cells: [{
        cell_type: "code",
        id: "r1",
        source: "x <- 1",
        execution_count: null,
        outputs: [],
        metadata: {},
      }],
    });
    const path = join(tmp, "r.ipynb");
    await Deno.writeTextFile(path, rNotebook);
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER_BUFNR;
    await dispatcher.open(VIEWER_BUFNR, path);
    host.calls = [];
    await dispatcher.editCell(VIEWER_BUFNR, "r1");

    const bufadds = host.callsTo("bufadd").map((c) => String(c.args[1]));
    assert(bufadds.some((n) => n.includes("__europa_cell_r1__")));
    assertEquals(await exists(join(tmp, ".europa", "lsp", "r.py")), false);
  });

  it("exposes no client-selection config (client-agnostic, FR-007a)", async () => {
    const config = await loadConfig(host);
    const keys = Object.keys(config);
    assert(keys.includes("lsp_enable"));
    assert(
      !keys.some((k) => /client/i.test(k)),
      "Europa must not expose an LSP client-selection option",
    );
  });
});

describe("mirror / 004-scratch coexistence", () => {
  // A mirror and a 004 scratch can coexist in one session: editCell re-reads
  // g:europa_lsp_enable on every call, so disabling it after a mirror was
  // materialized opens a scratch while session.lspMirror is still set. The
  // save / wipeout handlers must branch on WHICH buffer fired, not on the
  // mere presence of mirror state — otherwise a scratch `:w` is misrouted
  // through the marker-based distributor (no markers → edit silently lost)
  // and a scratch wipeout deletes the shared mirror.
  const VIEWER = 7;
  const MIRROR_CELL = "lsp-cross-cell-1";
  const SCRATCH_CELL = "lsp-cross-cell-2";

  let host: MockHost;
  let tmp: string;
  let notebookPath: string;

  beforeEach(async () => {
    host = mockVim();
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-coexist-" });
    await Deno.writeTextFile(join(tmp, "pyproject.toml"), "[project]\n");
    notebookPath = join(tmp, "demo.ipynb");
    const fixture = await Deno.readTextFile(
      new URL("../../fixtures/ipynb/lsp-cross-cell.ipynb", import.meta.url),
    );
    await Deno.writeTextFile(notebookPath, fixture);
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  /** Materialize the mirror, then disable LSP and open a 004 scratch. */
  async function openMirrorThenScratch(
    dispatcher: ReturnType<typeof buildDispatcher>,
  ): Promise<number> {
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // mirror materialized
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
    await dispatcher.editCell(VIEWER, SCRATCH_CELL); // 004 scratch opens
    const scratchBufnr = await host.call(
      "bufnr",
      `__europa_cell_${SCRATCH_CELL}__`,
    ) as number;
    assert(scratchBufnr > 0, "a 004 scratch buffer must have been opened");
    return scratchBufnr;
  }

  it("deleting a cell edited via the mirror leaves the mirror intact", async () => {
    // The post-delete scratch fixup must never freeze the SHARED mirror:
    // marking it nofile/nomodifiable would break :w for every other cell and
    // make the following refreshMirror sync fail.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;

    await dispatcher.deleteCell(VIEWER, MIRROR_CELL);

    assertEquals(
      await host.call("getbufvar", mirrorBufnr, "&buftype"),
      "acwrite",
      "the mirror must not be frozen into a nofile buffer",
    );
    const lines = host.getBufLines(mirrorBufnr);
    assert(
      !lines.some((l) => l.includes("[Cell deleted")),
      "the deletion marker must not be appended to the mirror",
    );
    assertEquals(
      lines.filter((l) => l.startsWith("# %% ")).length,
      1,
      "the mirror must be regenerated for the remaining cell",
    );
  });

  it("joining cells edited via the mirror leaves the mirror intact", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // registers cell 1
    await dispatcher.editCell(VIEWER, SCRATCH_CELL); // registers cell 2
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;

    await dispatcher.joinCell(VIEWER, SCRATCH_CELL);

    assertEquals(
      await host.call("getbufvar", mirrorBufnr, "&buftype"),
      "acwrite",
      "the joined-away cell's fixup must not freeze the mirror",
    );
    const lines = host.getBufLines(mirrorBufnr);
    assertEquals(
      lines.filter((l) => l.startsWith("# %% ")).length,
      1,
      "the surviving cell's fixup must not replace the regenerated mirror",
    );
    assert(
      lines.includes("a = 1") && lines.includes("print(a)"),
      "the mirror must show the merged cell with its marker",
    );
  });

  it("splitting a cell edited via the mirror leaves the mirror intact", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;

    await dispatcher.splitCell(mirrorBufnr, MIRROR_CELL, 1);

    const lines = host.getBufLines(mirrorBufnr);
    assertEquals(
      lines.filter((l) => l.startsWith("# %% ")).length,
      3,
      "the post-split fixup must not replace the regenerated mirror",
    );
  });

  it("disabling LSP opens a 004 scratch even for a cell edited via the mirror", async () => {
    // The mirror bufnr is registered under the cell's id; the scratch
    // fallback must not adopt it as the "existing scratch", or flipping
    // g:europa_lsp_enable off appears to have no effect for that cell.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // registered to the mirror
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
    host.calls = [];

    await dispatcher.editCell(VIEWER, MIRROR_CELL);

    const bufadds = host.callsTo("bufadd").map((c) => String(c.args[1]));
    assert(
      bufadds.some((n) => n.includes(`__europa_cell_${MIRROR_CELL}__`)),
      "a 004 scratch must open for the cell, not the mirror buffer",
    );
  });

  it("re-focusing a stale (shorter) mirror buffer clamps its folds", async () => {
    // A stale buffer can be shorter than the fresh regions; an out-of-range
    // fold raises E16 and aborts editCell entirely.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;
    // Trim the buffer to one line with unsaved edits, then mutate the
    // notebook so the regions grow while the buffer stays short (stale).
    const total = host.getBufLines(mirrorBufnr).length;
    await host.call("setbufline", mirrorBufnr, 1, ["short"]);
    await host.call("deletebufline", mirrorBufnr, 2, total);
    await host.call("setbufvar", mirrorBufnr, "&modified", 1);
    await dispatcher.insertCell(VIEWER, "code", "after", MIRROR_CELL);
    host.calls = [];

    await dispatcher.editCell(VIEWER, MIRROR_CELL);

    const oversizedFolds = host.calls.filter((c) => {
      if (c.method !== "cmd") return false;
      const m = /^(\d+),(\d+)fold$/.exec(String(c.args[0]));
      return m !== null && Number(m[2]) > 1;
    });
    assertEquals(
      oversizedFolds.length,
      0,
      "fold ranges must be clamped to the stale buffer's line count",
    );
  });

  it("undoing a scratch save never replays its source into the mirror", async () => {
    // A scratch-save undo entry carries scratchSync{cellId, preSource}; after
    // a scratch→mirror re-registration the cellId resolves to the MIRROR
    // bufnr, and replaying preSource there would wipe the regenerated mirror.
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // 004 scratch
    const scratchBufnr = await host.call(
      "bufnr",
      `__europa_cell_${MIRROR_CELL}__`,
    ) as number;
    await host.call("setbufline", scratchBufnr, 1, ["a = 42"]);
    await dispatcher.saveCellEdit(scratchBufnr); // undo entry w/ scratchSync

    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, "auto");
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // mirror takes the slot
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;

    await dispatcher.europaUndo(VIEWER);
    await new Promise((r) => setTimeout(r, 80)); // drain the undo FIFO

    const markers = host.getBufLines(mirrorBufnr)
      .filter((l) => l.startsWith("# %% "));
    assertEquals(
      markers.length,
      2,
      "the mirror must keep the regenerated (undone) content, not preSource",
    );
  });

  it("a mirror orphaned by a scratch re-registration still saves and cleans up", async () => {
    // Re-opening a cell as a 004 scratch (after the toggle flips) overwrites
    // the cellId→bufnr registration; the still-open mirror must remain
    // reachable via lspMirror state, or its :w becomes a silent no-op and
    // its wipeout leaks the on-disk file.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    host.setEval(`get(g:, 'europa_lsp_enable', "auto")`, false);
    await dispatcher.editCell(VIEWER, MIRROR_CELL); // scratch takes the slot

    const lines = host.getBufLines(mirrorBufnr).slice();
    lines[lines.indexOf("a = 1")] = "a = 42";
    await host.call("setbufline", mirrorBufnr, 1, lines);
    await dispatcher.saveCellEdit(mirrorBufnr);
    assert(
      host.getBufLines(VIEWER).some((l) => l.includes("a = 42")),
      "the orphaned mirror's :w must still reach the notebook",
    );

    await dispatcher.closeCellEdit(mirrorBufnr);
    assertEquals(
      await exists(mirrorFile),
      false,
      "the orphaned mirror's wipeout must still remove the file",
    );
  });

  it("saving a 004 scratch while a mirror exists commits the scratch edit", async () => {
    const dispatcher = buildDispatcher(host);
    const scratchBufnr = await openMirrorThenScratch(dispatcher);
    await host.call("setbufline", scratchBufnr, 1, ["b = 99"]);
    await dispatcher.saveCellEdit(scratchBufnr);

    const viewerLines = host.getBufLines(VIEWER);
    assert(
      viewerLines.some((l) => l.includes("b = 99")),
      "the scratch edit must reach the cell (not be lost in the mirror path)",
    );
    // The on-disk mirror is regenerated from the updated notebook.
    const mirrorText = await Deno.readTextFile(
      join(tmp, ".europa", "lsp", "demo.py"),
    );
    assert(
      mirrorText.includes("b = 99"),
      "the mirror must be regenerated with the scratch edit",
    );
  });

  it("wiping a 004 scratch while a mirror exists keeps the mirror file + state", async () => {
    const dispatcher = buildDispatcher(host);
    const scratchBufnr = await openMirrorThenScratch(dispatcher);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    assertEquals(await exists(mirrorFile), true);

    await dispatcher.closeCellEdit(scratchBufnr);
    assertEquals(
      await exists(mirrorFile),
      true,
      "a scratch wipeout must not delete the shared mirror file",
    );
  });

  it("wiping a mirror that served several cells clears every registration", async () => {
    // The mirror is registered once per edited cell; removing only the
    // entry the wipeout resolved to leaves the other cellId→bufnr entries
    // dangling, and a later save against the dead bufnr would route the
    // whole mirror text into that cell via the 004 scratch path.
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    await dispatcher.editCell(VIEWER, SCRATCH_CELL); // same mirror, 2nd cell
    const mirrorBufnr = await host.call(
      "bufnr",
      join(tmp, ".europa", "lsp", "demo.py"),
    ) as number;
    assert(mirrorBufnr > 0);

    await dispatcher.closeCellEdit(mirrorBufnr);

    const before = host.getBufLines(VIEWER).slice();
    await dispatcher.saveCellEdit(mirrorBufnr);
    assertEquals(
      host.getBufLines(VIEWER),
      before,
      "a save against the wiped mirror bufnr must be a no-op",
    );
  });

  it("wiping the mirror buffer itself still cleans up the mirror file", async () => {
    const dispatcher = buildDispatcher(host);
    host.currentBufnr = VIEWER;
    await dispatcher.open(VIEWER, notebookPath);
    await dispatcher.editCell(VIEWER, MIRROR_CELL);
    const mirrorFile = join(tmp, ".europa", "lsp", "demo.py");
    const mirrorBufnr = await host.call("bufnr", mirrorFile) as number;
    assert(mirrorBufnr > 0);

    await dispatcher.closeCellEdit(mirrorBufnr);
    assertEquals(
      await exists(mirrorFile),
      false,
      "wiping the mirror buffer must remove the mirror file (FR-018)",
    );
  });
});
