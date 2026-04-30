/**
 * BDD specs for setupAutocmds — BufReadCmd, BufWriteCmd, BufUnload registration.
 *
 * @spec-id europa.session.events.bufreadcmd
 * @spec-id europa.session.events.bufwritecmd
 * @spec-id europa.session.events.cleanup
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { setupAutocmds } from "../../../denops/europa/session/events.ts";
import { mockVim } from "../../fixtures/mock-host.ts";

describe("setupAutocmds", () => {
  it("registers BufReadCmd for *.ipynb", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufReadCmd");
    const hasBufRead = cmds.some((c) =>
      String(c.args[0]).includes("BufReadCmd") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufRead, true);
  });

  it("uses the europa_ipynb autocmd group", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const groupCmds = host.cmdsMatching("europa_ipynb");
    assertEquals(groupCmds.length > 0, true);
  });

  it("sets filetype=europa inside BufReadCmd so syntax is applied", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const hasSetFiletype = host.cmdsMatching("BufReadCmd").some((c) =>
      String(c.args[0]).includes("setfiletype europa")
    );
    assertEquals(hasSetFiletype, true);
  });
});

describe("setupAutocmds", () => {
  it("registers BufWriteCmd for *.ipynb", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufWriteCmd");
    const hasBufWrite = cmds.some((c) =>
      String(c.args[0]).includes("BufWriteCmd") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufWrite, true);
  });
});

describe("setupAutocmds", () => {
  it("registers BufUnload for *.ipynb cleanup", async () => {
    const host = mockVim();
    await setupAutocmds(host);
    const cmds = host.cmdsMatching("BufUnload");
    const hasBufUnload = cmds.some((c) =>
      String(c.args[0]).includes("BufUnload") &&
      String(c.args[0]).includes("*.ipynb")
    );
    assertEquals(hasBufUnload, true);
  });
});
