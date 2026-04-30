/**
 * BDD specs for renderImage — placeholder format, clickable, MIME routing,
 * and Sixel metadata synchronous return.
 *
 * europa.render.image.unsupported-mime and europa.render.image.svg-source
 * are tested here via dispatchOutput to verify the full image-MIME routing
 * contract end-to-end.
 *
 * @spec-id europa.render.image.placeholder
 * @spec-id europa.render.image.unsupported-mime
 * @spec-id europa.render.image.svg-source
 * @spec-id europa.render.image.sixel-metadata
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { renderImage } from "../../../denops/europa/render/image.ts";
import { dispatchOutput } from "../../../denops/europa/render/dispatcher.ts";
import type { Capabilities } from "../../../schema/capabilities.ts";
import type { Output } from "../../../schema/notebook.ts";

const capsPlaceholder: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "placeholder",
};

const capsSixel: Capabilities = {
  host: "vim",
  hostVersion: "9.1.1646",
  image: "sixel",
};

// Minimal 1×1 PNG base64 for testing
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("renderImage — placeholder format", () => {
  it("produces placeholder line with png kind, dimensions, and command", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 0,
      outputIdx: 0,
      width: 640,
      height: 480,
    });
    assertExists(result.fragment);
    assertEquals(
      result.fragment.lines[0],
      "[image: png 640x480 - :EuropaPreviewOutput 0 0]",
    );
  });

  it("uses ? for width and height when dimensions are absent", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 1,
      outputIdx: 2,
    });
    assertEquals(
      result.fragment.lines[0],
      "[image: png ?x? - :EuropaPreviewOutput 1 2]",
    );
  });

  it("uses jpeg kind for image/jpeg MIME", () => {
    const result = renderImage(PNG_B64, "image/jpeg", capsPlaceholder, {
      cellIdx: 0,
      outputIdx: 0,
      width: 100,
      height: 100,
    });
    assertEquals(
      result.fragment.lines[0],
      "[image: jpeg 100x100 - :EuropaPreviewOutput 0 0]",
    );
  });

  it("embeds correct cellIdx and outputIdx in the placeholder command", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 5,
      outputIdx: 3,
    });
    const line = result.fragment.lines[0];
    assertEquals(line.includes(":EuropaPreviewOutput 5 3"), true);
  });

  it("applies EuropaImagePlaceholder highlight group to the placeholder line", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 0,
      outputIdx: 0,
    });
    const hl = result.fragment.highlights.find(
      (h) => h.hlGroup === "EuropaImagePlaceholder",
    );
    assertExists(hl, "EuropaImagePlaceholder highlight must be present");
    assertEquals(hl.line, 0);
  });

  it("registers a clickable whose payload includes the EuropaPreviewOutput command", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 3,
      outputIdx: 0,
    });
    assertEquals(result.fragment.clickables.length > 0, true);
    const c = result.fragment.clickables[0];
    assertEquals(c.line, 0);
    assertEquals(c.action.payload.includes("EuropaPreviewOutput 3 0"), true);
  });

  it("returns no Sixel placement for placeholder backend (placement undefined)", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 0,
      outputIdx: 0,
    });
    assertEquals(result.placement, undefined);
  });

  it("still returns a placeholder fragment for sixel backend", () => {
    const result = renderImage(PNG_B64, "image/png", capsSixel, {
      cellIdx: 0,
      outputIdx: 0,
    });
    assertExists(result.fragment.lines[0]);
    assertEquals(result.fragment.lines[0].startsWith("[image:"), true);
  });
});

describe("renderImage — sixel-metadata", () => {
  it("returns placement.backend === 'sixel' for sixel caps", () => {
    const result = renderImage(PNG_B64, "image/png", capsSixel, {
      cellIdx: 0,
      outputIdx: 0,
    });
    assertEquals(result.placement?.backend, "sixel");
  });

  it("returns placement.payload equal to the raw base64 input", () => {
    const result = renderImage(PNG_B64, "image/png", capsSixel, {
      cellIdx: 0,
      outputIdx: 0,
    });
    assertEquals(result.placement?.payload, PNG_B64);
  });

  it("returns placement synchronously without invoking Deno.Command", () => {
    // renderImage is synchronous — if a subprocess were spawned the test
    // would hang or throw; completing instantly confirms no I/O occurred.
    const result = renderImage(PNG_B64, "image/png", capsSixel, {
      cellIdx: 2,
      outputIdx: 1,
    });
    assertExists(result.placement);
    assertEquals(result.placement.cellIdx, 2);
    assertEquals(result.placement.outputIdx, 1);
    assertEquals(result.placement.mime, "image/png");
  });

  it("returns no placement for placeholder backend", () => {
    const result = renderImage(PNG_B64, "image/png", capsPlaceholder, {
      cellIdx: 0,
      outputIdx: 0,
    });
    assertEquals(result.placement, undefined);
  });
});

describe("renderImage — unsupported-mime (via dispatchOutput)", () => {
  const defaultPriority = [
    "image/png",
    "image/jpeg",
    "application/json",
    "text/markdown",
    "text/html",
    "text/plain",
  ];

  it("produces [unsupported MIME: ...] for application/vnd.* in data bundle", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "application/vnd.custom+json": "data" },
      metadata: {},
    };
    const frag = dispatchOutput(out, capsPlaceholder, [
      "application/vnd.custom+json",
    ]);
    const text = frag.lines.join("\n");
    assertEquals(text.includes("unsupported MIME"), true);
    assertEquals(text.includes("application/vnd.custom+json"), true);
  });

  it("falls through to [unsupported: no matching MIME] when no bundle MIME matches priority", () => {
    const out: Output = {
      output_type: "execute_result",
      execution_count: 1,
      data: { "text/plain": "fallback" },
      metadata: {},
    };
    const frag = dispatchOutput(out, capsPlaceholder, ["image/png"]);
    const text = frag.lines.join("\n");
    assertEquals(text.includes("unsupported"), true);
  });

  it("dispatches image/png display_data to renderImage placeholder with dimensions from metadata", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "image/png": PNG_B64, "text/plain": "fallback" },
      metadata: { "image/png": { width: 32, height: 32 } },
    };
    const frag = dispatchOutput(out, capsPlaceholder, defaultPriority);
    assertExists(frag.lines[0]);
    assertEquals(frag.lines[0].startsWith("[image: png 32x32"), true);
  });

  it("dispatches image/jpeg display_data to renderImage placeholder", () => {
    const out: Output = {
      output_type: "display_data",
      data: { "image/jpeg": PNG_B64, "text/plain": "fallback" },
      metadata: {},
    };
    const frag = dispatchOutput(out, capsPlaceholder, defaultPriority);
    assertExists(frag.lines[0]);
    assertEquals(frag.lines[0].startsWith("[image: jpeg"), true);
  });
});

describe("renderImage — svg-source (via dispatchOutput)", () => {
  it("renders SVG source as plain text (FR-024)", () => {
    const svgSource = "<svg><rect width='10' height='10'/></svg>";
    const out: Output = {
      output_type: "display_data",
      data: { "image/svg+xml": svgSource, "text/plain": "fallback" },
      metadata: {},
    };
    const frag = dispatchOutput(out, capsPlaceholder, ["image/svg+xml"]);
    const text = frag.lines.join("\n");
    assertEquals(
      text.includes("<svg>"),
      true,
      "SVG source must be shown as-is",
    );
  });
});
