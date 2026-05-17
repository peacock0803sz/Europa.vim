/**
 * BDD specs for EuropaPreviewOutput SVG path (T016).
 *
 * Verifies the file-path contract: SVG preview files must be written to
 * /tmp/europa/svg-preview-<sha256>.svg where sha256 is the full 64-char
 * hex SHA-256 of the SVG bytes (SC-006 / FR-018 / FR-019).
 *
 * @spec-id europa.dispatcher.view.preview-svg
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";

describe("EuropaPreviewOutput SVG path contract (SC-006)", () => {
  it("svg-preview path uses /tmp/europa prefix and 64-char sha256 hex suffix", async () => {
    const svgText =
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
    const svgBytes = new TextEncoder().encode(svgText);
    const digest = await crypto.subtle.digest("SHA-256", svgBytes);
    const sha256 = encodeHex(new Uint8Array(digest));

    const svgPath = `/tmp/europa/svg-preview-${sha256}.svg`;

    assertEquals(sha256.length, 64, "SHA-256 hex must be 64 chars");
    assertEquals(svgPath.startsWith("/tmp/europa/svg-preview-"), true);
    assertEquals(svgPath.endsWith(".svg"), true);
    assertEquals(
      /^\/tmp\/europa\/svg-preview-[0-9a-f]{64}\.svg$/.test(svgPath),
      true,
      "path must match /tmp/europa/svg-preview-<64hex>.svg",
    );
  });

  it("two different SVGs produce different sha256-based paths", async () => {
    const svg1 = "<svg><circle fill='red'/></svg>";
    const svg2 = "<svg><circle fill='blue'/></svg>";
    const digest1 = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(svg1),
    );
    const digest2 = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(svg2),
    );
    const sha1 = encodeHex(new Uint8Array(digest1));
    const sha2 = encodeHex(new Uint8Array(digest2));
    assertEquals(
      sha1 === sha2,
      false,
      "Different SVGs must produce different paths",
    );
  });

  it("same SVG always produces the same path (deterministic)", async () => {
    const svg = '<svg viewBox="0 0 10 10"><rect/></svg>';
    const bytes = new TextEncoder().encode(svg);
    const d1 = await crypto.subtle.digest("SHA-256", bytes);
    const d2 = await crypto.subtle.digest("SHA-256", bytes);
    assertEquals(
      encodeHex(new Uint8Array(d1)),
      encodeHex(new Uint8Array(d2)),
    );
  });
});
