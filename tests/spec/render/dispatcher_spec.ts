/**
 * BDD specs for dispatchOutput — MIME priority routing.
 *
 * @spec-id europa.render.dispatcher.mime-priority
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { dispatchOutput } from "../../../denops/europa/render/dispatcher.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";

const caps: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
};

const defaultMimePriority = [
  "image/png",
  "image/jpeg",
  "application/json",
  "text/markdown",
  "text/html",
  "text/plain",
];

describe("dispatchOutput / @spec-id europa.render.dispatcher.mime-priority", () => {
  it("routes stream outputs directly", () => {
    const out: Output = {
      output_type: "stream",
      name: "stdout",
      text: "hello\n",
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag);
    assertExists(frag.lines);
    assertEquals(frag.lines.some((l: string) => l.includes("hello")), true);
  });

  it("routes error outputs", () => {
    const out: Output = {
      output_type: "error",
      ename: "ValueError",
      evalue: "bad value",
      traceback: ["line1", "line2"],
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("ValueError")),
      true,
    );
  });

  it("selects text/plain from execute_result when highest priority present", () => {
    const out: Output = {
      output_type: "execute_result",
      execution_count: 1,
      data: { "text/plain": "42" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["text/plain"]);
    assertExists(frag.lines);
    assertEquals(frag.lines.some((l: string) => l.includes("42")), true);
  });

  it("selects application/json over text/plain when first in priority", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "application/json": { x: 1 }, "text/plain": "fallback" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["application/json", "text/plain"]);
    assertExists(frag.lines);
    // JSON pretty-printed output should contain the key
    assertEquals(frag.lines.some((l: string) => l.includes("x")), true);
  });

  it("falls back to text/plain when higher-priority MIMEs absent", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "text/plain": "plain only" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, defaultMimePriority);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("plain only")),
      true,
    );
  });

  it("produces unsupported placeholder for unknown MIME", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "application/vnd.custom": "data" },
      metadata: {},
    };
    const frag = dispatchOutput(out, caps, ["application/vnd.custom"]);
    assertExists(frag.lines);
    assertEquals(
      frag.lines.some((l: string) => l.includes("unsupported")),
      true,
    );
  });
});
