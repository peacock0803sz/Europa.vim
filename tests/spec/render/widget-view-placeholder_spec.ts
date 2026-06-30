/**
 * BDD specs that lock in the Phase 5.1 negative invariant for
 * `application/vnd.jupyter.widget-view+json`: the renderer must still emit
 * the Phase 4 `[unsupported MIME: ...]` placeholder because widget rendering
 * is a Phase 5 item-2 deliverable, not part of the transport slice.
 *
 * @spec-id europa.kernel.comm.widget-view-placeholder-unchanged
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { dispatchOutput } from "../../../denops/europa/render/dispatcher.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";

const TEXT_CAPS: Capabilities = {
  host: "vim",
  hostVersion: "9.1",
  image: "placeholder",
  treeSitter: { available: false },
};

describe("Renderer — widget-view+json placeholder unchanged", () => {
  it("display_data with widget-view+json emits the unsupported-MIME placeholder", () => {
    const output: Output = {
      output_type: "display_data",
      data: {
        "application/vnd.jupyter.widget-view+json": {
          version_major: 2,
          version_minor: 0,
          model_id: "abc123",
        },
        "text/plain": "FloatSlider(value=0.0)",
      },
      metadata: {},
    };
    const fragment = dispatchOutput(
      output,
      TEXT_CAPS,
      [
        "application/vnd.jupyter.widget-view+json",
        "text/plain",
      ],
    );
    const text = fragment.lines.join("\n");
    assertEquals(
      text.includes(
        "[unsupported MIME: application/vnd.jupyter.widget-view+json]",
      ),
      true,
    );
  });

  it("execute_result with widget-view+json also emits the placeholder (not the widget)", () => {
    const output: Output = {
      output_type: "execute_result",
      execution_count: 1,
      data: {
        "application/vnd.jupyter.widget-view+json": {
          version_major: 2,
          version_minor: 0,
          model_id: "abc",
        },
      },
      metadata: {},
    };
    const fragment = dispatchOutput(
      output,
      TEXT_CAPS,
      ["application/vnd.jupyter.widget-view+json"],
    );
    const text = fragment.lines.join("\n");
    assertEquals(
      text.includes(
        "[unsupported MIME: application/vnd.jupyter.widget-view+json]",
      ),
      true,
    );
  });
});
