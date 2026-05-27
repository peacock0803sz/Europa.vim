/**
 * Conformance: the Europa notebook mirror is correctly analyzed by the real
 * pyright / ruff binaries (Phase 3.9, US1 / US3 / US4 / US6).
 *
 * Rather than drive a specific LSP client (client-agnostic, FR-007a), this
 * runs the analyzers directly on the `.py` mirror that `buildMirror` produces
 * — the exact file any client would attach to — and asserts:
 *   - a real type error surfaces (SC-005)
 *   - a symbol defined in an upper cell is NOT undefined in a lower cell (SC-007)
 *   - the suppression header silences bare-expression lint (SC-013)
 *   - a commented magic cell does not cascade syntax errors (SC-013)
 *   - ruff format reformats an unformatted cell (SC-008)
 *
 * Skips early if pyright / ruff are not installed (see tests/pyproject.toml),
 * matching the conformance-tier convention.
 *
 * @module tests/conformance/lsp_e2e_spec
 * @spec-id europa.lsp.conformance.mirror-analysis
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import type { Cell, Notebook } from "../../schema/notebook.ts";
import { buildMirror } from "../../denops/europa/lsp/mirror.ts";

function code(id: string, source: string): Cell {
  return {
    cell_type: "code",
    id,
    source,
    execution_count: null,
    outputs: [],
    metadata: {},
  };
}

function nb(cells: Cell[]): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells };
}

async function hasBinary(cmd: string): Promise<boolean> {
  try {
    await new Deno.Command(cmd, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return true;
  } catch {
    return false;
  }
}

async function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** Write a notebook's mirror to `<dir>/mirror.py` and return the path. */
async function writeMirror(dir: string, notebook: Notebook): Promise<string> {
  const path = join(dir, "mirror.py");
  await Deno.writeTextFile(path, buildMirror(notebook).text);
  return path;
}

describe("LSP mirror conformance (real pyright / ruff)", () => {
  let tmp: string;
  let havePyright = false;
  let haveRuff = false;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "europa-lsp-conf-" });
    havePyright = await hasBinary("pyright");
    haveRuff = await hasBinary("ruff");
  });
  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  });

  it("pyright reports a real type error in the mirror (SC-005)", async () => {
    if (!havePyright) return; // skip: pyright not installed
    const path = await writeMirror(
      tmp,
      nb([code("c1", 'x: int = "s"\ny = 1\nz = x + y')]),
    );
    const { stdout } = await run("pyright", ["--outputjson", path]);
    const report = JSON.parse(stdout);
    const errors = (report.generalDiagnostics ?? []).filter(
      (d: { severity: string }) => d.severity === "error",
    );
    assert(errors.length >= 1, 'pyright should flag x: int = "s"');
  });

  it("cross-cell symbols resolve (no reportUndefinedVariable) (SC-007)", async () => {
    if (!havePyright) return;
    const path = await writeMirror(
      tmp,
      nb([code("c1", "a = 1"), code("c2", "print(a)")]),
    );
    const { stdout } = await run("pyright", ["--outputjson", path]);
    const report = JSON.parse(stdout);
    const undefinedVars = (report.generalDiagnostics ?? []).filter(
      (d: { rule?: string }) => d.rule === "reportUndefinedVariable",
    );
    assertEquals(undefinedVars.length, 0, "`a` must resolve across cells");
  });

  it("suppression header silences bare-expression + magic cells do not cascade (SC-013)", async () => {
    if (!havePyright) return;
    const path = await writeMirror(
      tmp,
      nb([
        code("c1", "data = [1, 2, 3]\ndata"), // trailing bare expression
        code("c2", "%timeit foo()"), // line magic → commented out
        code("c3", "w: int = 5\nv = w + 1"), // ordinary cell after a magic cell
      ]),
    );
    const { stdout } = await run("pyright", ["--outputjson", path]);
    const report = JSON.parse(stdout);
    const diags = report.generalDiagnostics ?? [];
    const unused = diags.filter(
      (d: { rule?: string }) => d.rule === "reportUnusedExpression",
    );
    assertEquals(unused.length, 0, "bare `data` must not be flagged");
    // The magic cell is commented, so `foo` is invisible and the following
    // ordinary cell is still analyzed without a cascading syntax error.
    const errors = diags.filter(
      (d: { severity: string }) => d.severity === "error",
    );
    assertEquals(
      errors.length,
      0,
      "no syntax/undefined errors from the mirror",
    );
  });

  it("ruff lint does not flag the suppressed bare expression (SC-013)", async () => {
    if (!haveRuff) return;
    const path = await writeMirror(
      tmp,
      nb([code("c1", "data = [1, 2, 3]\ndata")]),
    );
    const { stdout } = await run("ruff", [
      "check",
      "--output-format=json",
      path,
    ]);
    const violations = JSON.parse(stdout || "[]");
    const b018 = violations.filter((v: { code?: string }) => v.code === "B018");
    assertEquals(b018.length, 0, "B018 must be suppressed by the header");
  });

  it("ruff format reformats an unformatted cell in the mirror (SC-008)", async () => {
    if (!haveRuff) return;
    const path = await writeMirror(tmp, nb([code("c1", "x=1")]));
    await run("ruff", ["format", path]);
    const formatted = await Deno.readTextFile(path);
    assert(formatted.includes("x = 1"), "ruff should format x=1 → x = 1");
  });
});
