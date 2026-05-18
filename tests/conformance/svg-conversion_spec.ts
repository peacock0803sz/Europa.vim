/**
 * Conformance test: SVG → PNG conversion via real rsvg-convert binary.
 *
 * Invokes the actual rsvg-convert subprocess (not mocked) to verify that
 * the installed librsvg binary produces valid PNG bytes from SVG input.
 * Only checks that the output starts with the PNG signature bytes (R8);
 * pixel-level comparison is intentionally avoided to prevent CI flakiness
 * from font/renderer differences across platforms.
 *
 * Skips automatically when rsvg-convert is not available so non-nix
 * environments do not fail CI.
 *
 * @spec-id europa.conformance.svg-rsvg-binary
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

const TEST_SVG =
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red"/></svg>';

async function isRsvgConvertAvailable(): Promise<boolean> {
  try {
    const result = await new Deno.Command("rsvg-convert", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.code === 0;
  } catch {
    return false;
  }
}

describe("SVG → PNG conformance via real rsvg-convert binary (R8)", () => {
  it("rsvg-convert produces valid PNG bytes from SVG input", async () => {
    const available = await isRsvgConvertAvailable();
    if (!available) {
      console.log(
        "  [SKIP] rsvg-convert not found — skipping conformance test",
      );
      return;
    }

    const cmd = new Deno.Command("rsvg-convert", {
      args: ["--format=png"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(TEST_SVG));
    await writer.close();

    const { code, stdout } = await child.output();
    assertEquals(code, 0, "rsvg-convert must exit with code 0");
    assertEquals(
      stdout.length > PNG_SIGNATURE.length,
      true,
      "output must be non-empty PNG bytes",
    );
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      assertEquals(
        stdout[i],
        PNG_SIGNATURE[i],
        `PNG signature byte ${i} must match (0x${
          PNG_SIGNATURE[i].toString(16)
        })`,
      );
    }
  });
});
