/**
 * BDD specs verifying TypeBox ↔ TypeScript interface alignment (FR-070).
 *
 * These specs ensure that the static types derived from TypeBox schemas are
 * structurally compatible with the function signatures of their implementations.
 * They serve as compile-time checks surfaced as runtime assertions.
 *
 * @spec-id europa.contract.notebook-alignment
 * @spec-id europa.contract.config-alignment
 * @spec-id europa.contract.capabilities-alignment
 * @spec-id europa.contract.dispatcher-alignment
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { Value } from "@sinclair/typebox/value";
import { NotebookSchema } from "../../schema/notebook.ts";
import { EuropaConfigSchema } from "../../schema/config.ts";
import { CapabilitiesSchema } from "../../schema/capabilities.ts";
import { mockVim } from "../fixtures/mock-host.ts";
import { parseNotebook } from "../../denops/europa/notebook/parse.ts";
import { loadConfig } from "../../denops/europa/config.ts";
import { detectCapabilities } from "../../denops/europa/capabilities.ts";

const MINIMAL_NB = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [],
});

describe("TypeBox ↔ TS interface alignment — notebook", () => {
  it("parseNotebook return value satisfies NotebookSchema", async () => {
    const nb = await parseNotebook(MINIMAL_NB);
    const ok = Value.Check(NotebookSchema, nb);
    assertEquals(ok, true, "parseNotebook output must satisfy NotebookSchema");
  });
});

describe("TypeBox ↔ TS interface alignment — config", () => {
  it("loadConfig return value satisfies EuropaConfigSchema", async () => {
    const denops = mockVim();
    const config = await loadConfig(denops);
    const ok = Value.Check(EuropaConfigSchema, config);
    assertEquals(
      ok,
      true,
      "loadConfig output must satisfy EuropaConfigSchema",
    );
  });
});

describe("TypeBox ↔ TS interface alignment — capabilities", () => {
  it("detectCapabilities return value satisfies CapabilitiesSchema", async () => {
    const denops = mockVim();
    const caps = await detectCapabilities(denops);
    const ok = Value.Check(CapabilitiesSchema, caps);
    assertEquals(
      ok,
      true,
      "detectCapabilities output must satisfy CapabilitiesSchema",
    );
  });
});

describe("TypeBox ↔ TS interface alignment — dispatcher", () => {
  it("main.ts dispatcher record exposes init method", async () => {
    // Structural test: import and verify the dispatcher shape at runtime
    const { buildDispatcher } = await import(
      "../../denops/europa/main.ts"
    );
    assertEquals(typeof buildDispatcher, "function");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    assertEquals(typeof dispatcher.init, "function");
    assertEquals(typeof dispatcher.open, "function");
    assertEquals(typeof dispatcher.save, "function");
    assertEquals(typeof dispatcher.previewOutput, "function");
  });
});
