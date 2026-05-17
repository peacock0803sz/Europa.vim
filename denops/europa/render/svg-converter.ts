/**
 * SVG → PNG converter via rsvg-convert subprocess.
 *
 * Implements LRU caching (capacity 50), binary-missing short-circuit,
 * and in-flight deduplication for concurrent same-SVG requests.
 *
 * @category Render
 */

import { encodeBase64 } from "@std/encoding/base64";
import { encodeHex } from "@std/encoding/hex";
import { LruCache } from "@std/cache/lru-cache";
import type { SvgConversionResult } from "../../../schema/svg-conversion.ts";
import { pngDimensions } from "./image.ts";

const CACHE_CAPACITY = 50;

let _cache = new LruCache<string, Extract<SvgConversionResult, { ok: true }>>(
  CACHE_CAPACITY,
);
let _inFlight = new Map<string, Promise<SvgConversionResult>>();
let _binaryMissingWarned = false;
let _binaryMissingHandler: (() => void) | undefined;

/**
 * Register the handler called once on first `binary-missing` detection.
 *
 * @spec-id europa.render.image.svg-binary-missing-warning
 */
export function setBinaryMissingHandler(handler: () => void): void {
  _binaryMissingHandler = handler;
}

/**
 * Clear the LRU cache and the binary-missing short-circuit flag.
 * For test isolation only — production code must not call this.
 */
export function __resetSvgCacheForTest(): void {
  _cache = new LruCache<string, Extract<SvgConversionResult, { ok: true }>>(
    CACHE_CAPACITY,
  );
  _inFlight = new Map();
  _binaryMissingWarned = false;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeHex(new Uint8Array(digest));
}

async function runConvert(svgBytes: string): Promise<SvgConversionResult> {
  const sha256 = await sha256Hex(svgBytes);

  let cmd: Deno.ChildProcess;
  try {
    const command = new Deno.Command("rsvg-convert", {
      args: ["--format=png"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    cmd = command.spawn();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      if (!_binaryMissingWarned) {
        _binaryMissingWarned = true;
        _binaryMissingHandler?.();
      }
      return { ok: false, reason: "binary-missing" };
    }
    return { ok: false, reason: "convert-failed", stderr: String(err) };
  }

  const writer = cmd.stdin.getWriter();
  await writer.write(new TextEncoder().encode(svgBytes));
  await writer.close();

  const { code, stdout, stderr } = await cmd.output();

  if (code !== 0) {
    const stderrText = new TextDecoder().decode(stderr);
    return { ok: false, reason: "convert-failed", stderr: stderrText };
  }

  const pngBase64 = encodeBase64(stdout);
  const dims = pngDimensions(pngBase64);
  const width = dims?.width ?? 0;
  const height = dims?.height ?? 0;

  const result = {
    ok: true as const,
    pngBase64,
    width,
    height,
    sha256,
  };
  _cache.set(sha256, result);
  return result;
}

/**
 * Convert SVG bytes to PNG via rsvg-convert, with LRU caching.
 *
 * Always resolves (never rejects). Cache hits skip the subprocess entirely.
 * In-flight deduplication prevents multiple subprocesses for the same SHA-256.
 *
 * @param svgBytes - Raw image/svg+xml string from Output.data.
 * @returns Always-resolving Promise<SvgConversionResult>.
 * @spec-id europa.render.image.svg-rsvg
 * @spec-id europa.render.image.svg-cache
 */
export async function convertSvgToPng(
  svgBytes: string,
): Promise<SvgConversionResult> {
  if (_binaryMissingWarned) {
    return { ok: false, reason: "binary-missing" };
  }

  const sha256 = await sha256Hex(svgBytes);

  const cached = _cache.get(sha256);
  if (cached) return cached;

  const inflight = _inFlight.get(sha256);
  if (inflight) return inflight;

  const promise = runConvert(svgBytes).finally(() => {
    _inFlight.delete(sha256);
  });
  _inFlight.set(sha256, promise);

  return promise;
}
