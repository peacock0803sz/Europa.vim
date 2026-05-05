/**
 * BDD specs verifying TypeBox ↔ TypeScript interface alignment (FR-070),
 * and the `:EuropaPreviewOutput` command/dispatcher contract (FR-019).
 *
 * @spec-id europa.contract.notebook-alignment
 * @spec-id europa.contract.config-alignment
 * @spec-id europa.contract.capabilities-alignment
 * @spec-id europa.contract.dispatcher-alignment
 * @spec-id europa.dispatcher.preview-output
 * @spec-id europa.commands.preview-output
 * @spec-id europa.dispatcher.save
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

const FIXTURE_PATH = new URL(
  "../golden/ipynb/edit-target.ipynb",
  import.meta.url,
).pathname;

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

describe("Phase 3.1 dispatcher method presence (europa.contract.dispatcher-phase3-1-alignment)", () => {
  /**
   * @spec-id europa.contract.dispatcher-phase3-1-alignment
   *
   * Verifies that all Phase 3.1 editing methods and internal RPCs are present
   * in the dispatcher produced by buildDispatcher. Each method must be a
   * function — the implementation may throw UnimplementedError, but the
   * method must be wired into the dispatcher object.
   */
  const PHASE31_EDITING_METHODS = [
    "insertCell",
    "deleteCell",
    "moveCell",
    "splitCell",
    "joinCell",
    "editCell",
    "changeCellType",
  ] as const;

  const PHASE31_INTERNAL_RPCS = [
    "saveCellEdit",
    "closeCellEdit",
    "lineToCellId",
  ] as const;

  it("exposes all Phase 3.1 editing methods", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    for (const method of PHASE31_EDITING_METHODS) {
      assertEquals(
        typeof d[method],
        "function",
        `dispatcher must have method: ${method}`,
      );
    }
  });

  it("exposes all Phase 3.1 internal RPC methods", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    for (const method of PHASE31_INTERNAL_RPCS) {
      assertEquals(
        typeof d[method],
        "function",
        `dispatcher must have internal RPC: ${method}`,
      );
    }
  });
});

describe("previewOutput dispatcher contract", () => {
  it("emits an echohl warning when no session is found for the bufnr", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    await dispatcher.previewOutput(9999, 0, 0);
    const errCmds = denops.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "previewOutput must emit echohl ErrorMsg when session not found",
    );
  });

  it("emits an echom warning containing 'Europa' when session is not found", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    await dispatcher.previewOutput(9999, 0, 0);
    const echomCmds = denops.cmdsMatching("echom");
    const hasEuropaMsg = echomCmds.some((c) =>
      String(c.args[0]).includes("Europa")
    );
    assertEquals(
      hasEuropaMsg,
      true,
      "previewOutput error message must include 'Europa'",
    );
  });

  it("returns without throwing even when session is missing", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    let threw = false;
    try {
      await dispatcher.previewOutput(9999, 0, 0);
    } catch {
      threw = true;
    }
    assertEquals(
      threw,
      false,
      "previewOutput must not throw on missing session",
    );
  });
});

describe("save dispatcher contract", () => {
  it("emits an echohl warning when no session is found for the bufnr", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    await dispatcher.save(9999);
    const errCmds = denops.cmdsMatching("echohl");
    assertEquals(
      errCmds.length > 0,
      true,
      "save must emit echohl ErrorMsg when session not found",
    );
  });

  it("returns without throwing even when session is missing", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const dispatcher = buildDispatcher(denops);
    let threw = false;
    try {
      await dispatcher.save(9999);
    } catch {
      threw = true;
    }
    assertEquals(threw, false, "save must not throw on missing session");
  });
});

describe("Phase 3.2 dispatcher method presence (europa.contract.dispatcher-phase3-2-alignment)", () => {
  /**
   * @spec-id europa.contract.dispatcher-phase3-2-alignment
   *
   * Verifies that Phase 3.2 kernel lifecycle methods are present and that
   * TypeBox argument validation works for valid and invalid inputs.
   *
   * The non-INVALID_ARGS assertions pass with the current dispatcher stubs
   * and will keep passing once US1/US2 wires up the real implementations.
   */
  const PHASE32_METHODS = [
    "startKernel",
    "shutdownKernel",
    "kernelStatus",
    "atexit",
  ] as const;

  it("exposes all Phase 3.2 kernel lifecycle methods", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    for (const method of PHASE32_METHODS) {
      assertEquals(
        typeof d[method],
        "function",
        `dispatcher must have Phase 3.2 method: ${method}`,
      );
    }
  });

  it("startKernel with valid bufnr does not throw INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    await d.open(1, FIXTURE_PATH);
    let threwInvalidArgs = false;
    try {
      await d.startKernel(1, "python3");
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) {
        threwInvalidArgs = true;
      }
    }
    assertEquals(
      threwInvalidArgs,
      false,
      "valid args must not throw INVALID_ARGS",
    );
  });

  it("kernelStatus with no kernel returns { info: null, wsState: 'NONE' }", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    const result = await d.kernelStatus(9999);
    assertEquals(result.info, null);
    assertEquals(result.wsState, "NONE");
  });
});

describe("Phase 3.3 dispatcher method presence (europa.contract.dispatcher-phase3-3-alignment)", () => {
  /**
   * @spec-id europa.contract.dispatcher-phase3-3-alignment
   *
   * Verifies that Phase 3.3 kernel control methods are present in the dispatcher
   * produced by buildDispatcher. TypeBox argument validation: invalid args throw
   * INVALID_ARGS, valid args do not.
   */
  const PHASE33_METHODS = [
    "runCell",
    "runAll",
    "interruptKernel",
    "restartKernel",
    "cancelCell",
  ] as const;

  it("exposes all Phase 3.3 kernel control methods", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    for (const method of PHASE33_METHODS) {
      assertEquals(
        typeof d[method],
        "function",
        `dispatcher must have Phase 3.3 method: ${method}`,
      );
    }
  });

  it("runCell with string bufnr throws INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    let threwInvalidArgs = false;
    try {
      await d.runCell("not-a-number", "cell-1");
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) threwInvalidArgs = true;
    }
    assertEquals(
      threwInvalidArgs,
      true,
      "string bufnr must throw INVALID_ARGS",
    );
  });

  it("runCell with empty cellId throws INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    let threwInvalidArgs = false;
    try {
      await d.runCell(1, "");
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) threwInvalidArgs = true;
    }
    assertEquals(
      threwInvalidArgs,
      true,
      "empty cellId must throw INVALID_ARGS",
    );
  });

  it("runCell with valid args does not throw INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    await d.open(1, FIXTURE_PATH);
    let threwInvalidArgs = false;
    try {
      await d.runCell(1, "cell-x");
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) threwInvalidArgs = true;
    }
    assertEquals(
      threwInvalidArgs,
      false,
      "valid args must not throw INVALID_ARGS",
    );
  });

  it("runAll with bufnr=0 throws INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    let threwInvalidArgs = false;
    try {
      await d.runAll(0);
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) threwInvalidArgs = true;
    }
    assertEquals(threwInvalidArgs, true, "bufnr=0 must throw INVALID_ARGS");
  });

  it("cancelCell with negative bufnr throws INVALID_ARGS", async () => {
    const { buildDispatcher } = await import("../../denops/europa/main.ts");
    const denops = mockVim();
    const d = buildDispatcher(denops);
    let threwInvalidArgs = false;
    try {
      await d.cancelCell(-1, "cell-x");
    } catch (e) {
      if (
        e && typeof e === "object" && "code" in e &&
        (e as { code: string }).code === "INVALID_ARGS"
      ) threwInvalidArgs = true;
    }
    assertEquals(
      threwInvalidArgs,
      true,
      "negative bufnr must throw INVALID_ARGS",
    );
  });
});

describe(":EuropaPreviewOutput command definition", () => {
  it("plugin/commands.vim defines the EuropaPreviewOutput command", async () => {
    const content = await Deno.readTextFile(
      new URL("../../plugin/commands.vim", import.meta.url),
    );
    assertEquals(
      content.includes("EuropaPreviewOutput"),
      true,
      "commands.vim must define EuropaPreviewOutput",
    );
  });

  it("autoload/europa.vim defines europa#preview_output with denops#notify", async () => {
    const content = await Deno.readTextFile(
      new URL("../../autoload/europa.vim", import.meta.url),
    );
    assertEquals(
      content.includes("europa#preview_output"),
      true,
      "autoload must define europa#preview_output",
    );
    assertEquals(
      content.includes("previewOutput"),
      true,
      "autoload must notify 'previewOutput' to denops",
    );
  });
});
