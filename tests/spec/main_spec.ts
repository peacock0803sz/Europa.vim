/**
 * BDD specs for buildDispatcher.open (US1: `.ipynb` cell-structure viewer).
 *
 * Verifies that calling `open(path)` reads the notebook file from disk, builds
 * a render plan, and reflects it into the current Vim buffer by issuing
 * `setlocal nomodifiable` and `setline`.
 *
 * @spec-id europa.main.open.render
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { mockVim } from "../fixtures/mock-host.ts";
import { buildDispatcher } from "../../denops/europa/main.ts";

const MINIMAL_NB = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [{
    cell_type: "code",
    source: "print('hello')",
    metadata: {},
    outputs: [],
    execution_count: null,
  }],
});

describe("buildDispatcher.open", () => {
  it("locks the target buffer via setbufvar &modifiable=0 after opening", async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".ipynb" });
    try {
      await Deno.writeTextFile(tmp, MINIMAL_NB);
      const denops = mockVim();
      const dispatcher = buildDispatcher(denops);
      await dispatcher.open(7, tmp);
      const lockCall = denops.callsTo("setbufvar").find((c) =>
        c.args[1] === 7 && c.args[2] === "&modifiable" && c.args[3] === 0
      );
      assertEquals(lockCall !== undefined, true);
    } finally {
      await Deno.remove(tmp);
    }
  });

  it("calls setbufline targeting the bufnr argument, not the current buffer", async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".ipynb" });
    try {
      await Deno.writeTextFile(tmp, MINIMAL_NB);
      const denops = mockVim();
      const dispatcher = buildDispatcher(denops);
      await dispatcher.open(7, tmp);
      const setbuflineCalls = denops.callsTo("setbufline");
      assertStringIncludes(
        JSON.stringify(setbuflineCalls),
        "print('hello')",
        "rendered lines must include the cell source",
      );
      assertEquals(
        setbuflineCalls.every((c) => c.args[1] === 7),
        true,
        "every setbufline call must target the passed bufnr",
      );
    } finally {
      await Deno.remove(tmp);
    }
  });
});
