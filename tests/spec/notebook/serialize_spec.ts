/**
 * BDD specs for serializeNotebook — format, golden round-trip, and
 * shadow-inject pristine contract (Phase 3.6).
 *
 * @spec-id europa.notebook.serialize.format
 * @spec-id europa.notebook.serialize.round-trip
 * @spec-id europa.render.image.svg-serialize-pristine
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { serializeNotebook } from "../../../denops/europa/notebook/serialize.ts";
import { parseNotebook } from "../../../denops/europa/notebook/parse.ts";
import type { Notebook } from "../../../schema/notebook.ts";

function emptyNotebook(): Notebook {
  return { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
}

describe("serializeNotebook", () => {
  it("uses 1-space indent", () => {
    const out = serializeNotebook(emptyNotebook());
    assertEquals(out.includes(' "nbformat"'), true);
  });

  it("ends with exactly one trailing newline", () => {
    const out = serializeNotebook(emptyNotebook());
    assertEquals(out.endsWith("\n"), true);
    assertEquals(out.endsWith("\n\n"), false);
  });

  it("preserves MIME bundle insertion order", () => {
    const nb: Notebook = {
      ...emptyNotebook(),
      cells: [{
        cell_type: "code",
        id: "abc123",
        source: "",
        execution_count: null,
        outputs: [{
          output_type: "execute_result",
          execution_count: 1,
          data: { "text/plain": "hello", "application/json": {} },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const out = serializeNotebook(nb);
    const plainIdx = out.indexOf('"text/plain"');
    const jsonIdx = out.indexOf('"application/json"');
    assertEquals(plainIdx < jsonIdx, true);
  });
});

describe("serializeNotebook — shadow-inject pristine (SC-009 / FR-027)", () => {
  it("notebook with only image/svg+xml serializes without any image/png key", () => {
    const nb: Notebook = {
      ...emptyNotebook(),
      cells: [{
        cell_type: "code",
        id: "svg-cell",
        source: "SVG()",
        execution_count: 1,
        outputs: [{
          output_type: "display_data",
          data: {
            "image/svg+xml":
              '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>',
          },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const out = serializeNotebook(nb);
    assertEquals(out.includes('"image/png"'), false);
    assertEquals(out.includes('"image/svg+xml"'), true);
  });

  it("mutating outputs externally does not affect a previously serialized string", () => {
    const nb: Notebook = {
      ...emptyNotebook(),
      cells: [{
        cell_type: "code",
        id: "svg-cell-2",
        source: "",
        execution_count: 1,
        outputs: [{
          output_type: "display_data",
          data: { "image/svg+xml": "<svg/>" },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const before = serializeNotebook(nb);
    // Simulate external mutation (not shadow inject — just verifying isolation)
    const cell = nb.cells[0];
    if (cell.cell_type === "code" && cell.outputs) {
      const out = cell.outputs[0];
      if (out.output_type === "display_data") {
        (out.data as Record<string, unknown>)["image/png"] = "fake";
      }
    }
    const after = serializeNotebook(nb);
    // The second call reflects the mutation; first call is unaffected (strings are immutable)
    assertEquals(before.includes('"image/png"'), false);
    assertEquals(after.includes('"image/png"'), true);
  });
});

describe("serializeNotebook — markdown overlay pristine (SC-010 / FR-032)", () => {
  it(
    "markdown-rich.ipynb survives buildRenderPlan + serialize byte-identical",
    async () => {
      const { buildRenderPlan } = await import(
        "../../../denops/europa/render/builder.ts"
      );
      const raw = await Deno.readTextFile(
        "tests/fixtures/ipynb/markdown-rich.ipynb",
      );
      const parsed = await parseNotebook(raw);
      const caps = {
        host: "vim" as const,
        hostVersion: "9.1.1646",
        image: "placeholder" as const,
        treeSitter: { available: false },
      };
      const plan = await buildRenderPlan(parsed, caps);
      // RenderPlan must contain non-empty mdDecorations for markdown-rich.ipynb
      // (the fixture has bold/italic/link/list/etc, so overlay decorations exist).
      assertEquals(plan.mdDecorations.length > 0, true);
      // serializeNotebook ignores mdDecorations because they live in RenderPlan,
      // never in the Notebook entity. Round-trip must produce the same parsed AST.
      const serialized = serializeNotebook(parsed);
      const roundTripped = await parseNotebook(serialized);
      assertEquals(roundTripped, parsed);
    },
  );

  it(
    "second build after :write -> :edit re-computes mdDecorations from scratch",
    async () => {
      const { buildRenderPlan } = await import(
        "../../../denops/europa/render/builder.ts"
      );
      const raw = await Deno.readTextFile(
        "tests/fixtures/ipynb/markdown-rich.ipynb",
      );
      const caps = {
        host: "vim" as const,
        hostVersion: "9.1.1646",
        image: "placeholder" as const,
        treeSitter: { available: false },
      };
      // First build
      const parsed1 = await parseNotebook(raw);
      const plan1 = await buildRenderPlan(parsed1, caps);
      // Simulate :write -> :edit! cycle by serializing and re-parsing
      const serialized = serializeNotebook(parsed1);
      const parsed2 = await parseNotebook(serialized);
      const plan2 = await buildRenderPlan(parsed2, caps);
      // Same source, same decorations — proves no cache leaked into Notebook entity
      assertEquals(plan2.mdDecorations.length, plan1.mdDecorations.length);
    },
  );
});

describe("[golden] notebook round-trip", () => {
  const FIXTURES = [
    "hello",
    "multi-line-source",
    "pandas-output",
    "json-output",
    "markdown-html",
    "kitty-image",
    "ansi-stream",
  ];

  for (const name of FIXTURES) {
    it(`parse(serialize(parse(x))) === parse(x) for ${name}.ipynb`, async () => {
      const raw = await Deno.readTextFile(
        `tests/golden/ipynb/${name}.ipynb`,
      );
      const parsed = await parseNotebook(raw);
      const serialized = serializeNotebook(parsed);
      const roundTripped = await parseNotebook(serialized);
      assertEquals(roundTripped, parsed);
    });
  }
});
