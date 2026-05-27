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
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path/join";
import { buildDispatcher } from "../../../denops/europa/main.ts";
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
});
