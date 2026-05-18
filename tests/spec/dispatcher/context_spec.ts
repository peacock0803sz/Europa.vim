/**
 * BDD specs for renderPlanOpts — config → BuildRenderPlanOpts mapping.
 *
 * Verifies that mime_priority (and other render-related config fields)
 * propagate from EuropaConfig into the BuildRenderPlanOpts so that
 * buildRenderPlan respects user-configured MIME priority.
 *
 * @spec-id europa.dispatcher.context.render-plan-opts
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { renderPlanOpts } from "../../../denops/europa/dispatcher/context.ts";
import type { EuropaConfig } from "../../../schema/config.ts";

function makeConfig(overrides: Partial<EuropaConfig> = {}): EuropaConfig {
  return {
    connection_mode: "auto",
    jupyter_url: "http://localhost:8888",
    jupyter_token: "",
    jupyter_ws_subprotocol: "auto",
    default_kernel: "python3",
    auto_start_kernel: false,
    jupyter_executable: "",
    python_env_detect: "auto",
    image_backend: "auto",
    mime_priority: [
      "image/png",
      "image/jpeg",
      "image/svg+xml",
      "text/html",
      "text/plain",
    ],
    max_output_lines: 100,
    cell_border_chars: ["╭", "─", "╮", "╰", "╯"],
    cell_border_padding: 4,
    cell_border_align: "left",
    lazy_padding: 10,
    auto_save: false,
    use_subprocess: true,
    wsReconnectMaxRetries: 5,
    wsReconnectInitialIntervalMs: 1000,
    wsReconnectMultiplier: 2.0,
    kernelInfoTimeoutMs: 10000,
    undo_max_history: 100,
    disable_default_mappings: false,
    ts_highlight: "auto",
    ...overrides,
  } as EuropaConfig;
}

describe("renderPlanOpts — config to BuildRenderPlanOpts mapping", () => {
  it("propagates mime_priority from config so SVG outputs are rendered", () => {
    const config = makeConfig();
    const opts = renderPlanOpts(config);
    assertEquals(
      opts.mimePriority?.includes("image/svg+xml"),
      true,
      "mime_priority from config must reach buildRenderPlan via opts.mimePriority",
    );
  });

  it("propagates user-customized mime_priority verbatim", () => {
    const config = makeConfig({
      mime_priority: ["image/png", "text/plain"],
    });
    const opts = renderPlanOpts(config);
    assertEquals(opts.mimePriority, ["image/png", "text/plain"]);
  });

  it("propagates other render fields (maxOutputLines, borders) as well", () => {
    const config = makeConfig({
      max_output_lines: 50,
      cell_border_padding: 2,
      cell_border_align: "center",
    });
    const opts = renderPlanOpts(config);
    assertEquals(opts.maxOutputLines, 50);
    assertEquals(opts.cellBorderPadding, 2);
    assertEquals(opts.cellBorderAlign, "center");
  });
});
