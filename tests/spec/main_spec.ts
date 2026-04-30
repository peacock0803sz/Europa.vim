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
import { assertStringIncludes } from "@std/assert";
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
  it("issues setlocal nomodifiable after opening a notebook", async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".ipynb" });
    try {
      await Deno.writeTextFile(tmp, MINIMAL_NB);
      const denops = mockVim();
      const dispatcher = buildDispatcher(denops);
      await dispatcher.open(tmp);
      const cmds = denops.cmdsMatching("nomodifiable").map((c) =>
        String(c.args[0])
      );
      assertStringIncludes(cmds.join(" "), "nomodifiable");
    } finally {
      await Deno.remove(tmp);
    }
  });

  it("calls setline to write rendered notebook lines into the buffer", async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".ipynb" });
    try {
      await Deno.writeTextFile(tmp, MINIMAL_NB);
      const denops = mockVim();
      const dispatcher = buildDispatcher(denops);
      await dispatcher.open(tmp);
      const setlineCalls = denops.callsTo("setline");
      assertStringIncludes(
        JSON.stringify(setlineCalls),
        "print('hello')",
        "rendered lines must include the cell source",
      );
    } finally {
      await Deno.remove(tmp);
    }
  });
});
