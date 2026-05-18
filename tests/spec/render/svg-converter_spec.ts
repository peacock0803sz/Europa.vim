/**
 * BDD specs for convertSvgToPng — LRU cache, binary detection,
 * subprocess args invariant, and test-reset hook.
 *
 * Uses Deno.Command mock pattern to avoid requiring a real rsvg-convert binary.
 * The implementation uses spawn() + stdin piping, so mocks implement spawn().
 *
 * @spec-id europa.render.image.svg-rsvg
 * @spec-id europa.render.image.svg-cache
 * @spec-id europa.render.image.svg-binary-missing-warning
 */
import { afterEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater } from "@std/assert";
import {
  __resetSvgCacheForTest,
  convertSvgToPng,
  setBinaryMissingHandler,
} from "../../../denops/europa/render/svg-converter.ts";

// Minimal valid PNG bytes (1×1 pixel) — signature + IHDR with width=1, height=1
const MINIMAL_PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR chunk length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
  0x00,
  0x00,
  0x00,
  0x01, // width = 1
  0x00,
  0x00,
  0x00,
  0x01, // height = 1
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0x90,
  0x77,
  0x53,
  0xde, // bit depth + crc
]);

const SVG_RED =
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
const SVG_BLUE =
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>';

// Build a fake Deno.ChildProcess whose output() returns the given result.
// stdin discards all writes (avoids backpressure issues).
function makeFakeChild(
  code: number,
  stdout: Uint8Array,
  stderr: Uint8Array,
  onOutput?: () => void,
): Deno.ChildProcess {
  const stdin = new WritableStream<Uint8Array>({
    write(_chunk) {},
    close() {},
  });
  return {
    stdin,
    output: () => {
      onOutput?.();
      return Promise.resolve({
        code,
        stdout,
        stderr,
        success: code === 0,
        signal: null,
      } as unknown as Deno.CommandOutput);
    },
    pid: 0,
    status: Promise.resolve({ code, success: code === 0, signal: null }),
    stdout: new ReadableStream(),
    stderr: new ReadableStream(),
    ref: () => {},
    unref: () => {},
    kill: () => {},
  } as unknown as Deno.ChildProcess;
}

// Stub that returns a successful PNG output via spawn()
function makeSuccessStub(
  pngBytes: Uint8Array,
  captureArgs?: { args: string[] },
): typeof Deno.Command {
  return class MockCommand {
    constructor(_cmd: string, opts?: Deno.CommandOptions) {
      if (captureArgs) captureArgs.args = (opts?.args ?? []) as string[];
    }
    spawn(): Deno.ChildProcess {
      return makeFakeChild(0, pngBytes, new Uint8Array());
    }
  } as unknown as typeof Deno.Command;
}

// Stub that throws Deno.errors.NotFound when spawn() is called
function makeNotFoundStub(onSpawn?: () => void): typeof Deno.Command {
  return class MockCommand {
    constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
    spawn(): Deno.ChildProcess {
      onSpawn?.();
      throw new Deno.errors.NotFound("rsvg-convert not found");
    }
  } as unknown as typeof Deno.Command;
}

// Stub that returns non-zero exit code with stderr
function makeFailStub(stderrMsg: string): typeof Deno.Command {
  return class MockCommand {
    constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
    spawn(): Deno.ChildProcess {
      return makeFakeChild(
        1,
        new Uint8Array(),
        new TextEncoder().encode(stderrMsg),
      );
    }
  } as unknown as typeof Deno.Command;
}

afterEach(() => {
  __resetSvgCacheForTest();
});

describe("convertSvgToPng — happy path", () => {
  it("returns ok:true with pngBase64, width, height, sha256 on success", async () => {
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeSuccessStub(MINIMAL_PNG);
      const result = await convertSvgToPng(SVG_RED);
      assertEquals(result.ok, true);
      if (result.ok) {
        assertGreater(result.pngBase64.length, 0);
        assertEquals(result.width, 1);
        assertEquals(result.height, 1);
        assertEquals(result.sha256.length, 64);
      }
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("convertSvgToPng — binary-missing", () => {
  it("returns ok:false reason:binary-missing when Deno.errors.NotFound is thrown", async () => {
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeNotFoundStub();
      const result = await convertSvgToPng(SVG_RED);
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.reason, "binary-missing");
      }
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });

  it("short-circuits subsequent calls after first binary-missing without spawning subprocess", async () => {
    let spawnCount = 0;
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeNotFoundStub(() => {
        spawnCount++;
      });
      await convertSvgToPng(SVG_RED);
      await convertSvgToPng(SVG_BLUE);
      assertEquals(
        spawnCount,
        1,
        "subprocess should only be attempted once after binary-missing",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("convertSvgToPng — never throws (contract)", () => {
  it("returns ok:false when stdin write rejects (subprocess pipe error)", async () => {
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = class MockCommand {
        constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
        spawn(): Deno.ChildProcess {
          // stdin write throws to simulate a closed pipe / subprocess crash
          const stdin = new WritableStream<Uint8Array>({
            write(_chunk) {
              throw new Error("pipe closed");
            },
          });
          return {
            stdin,
            output: () =>
              Promise.resolve({
                code: 0,
                stdout: MINIMAL_PNG,
                stderr: new Uint8Array(),
                success: true,
                signal: null,
              } as unknown as Deno.CommandOutput),
            pid: 0,
            status: Promise.resolve({ code: 0, success: true, signal: null }),
            stdout: new ReadableStream(),
            stderr: new ReadableStream(),
            ref: () => {},
            unref: () => {},
            kill: () => {},
          } as unknown as Deno.ChildProcess;
        }
      } as unknown as typeof Deno.Command;

      const result = await convertSvgToPng(SVG_RED);
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.reason, "convert-failed");
        assertEquals(typeof result.stderr, "string");
      }
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });

  it("returns ok:false when cmd.output() rejects", async () => {
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = class MockCommand {
        constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
        spawn(): Deno.ChildProcess {
          const stdin = new WritableStream<Uint8Array>({
            write(_chunk) {},
            close() {},
          });
          return {
            stdin,
            output: () => Promise.reject(new Error("subprocess crash")),
            pid: 0,
            status: Promise.resolve({ code: 1, success: false, signal: null }),
            stdout: new ReadableStream(),
            stderr: new ReadableStream(),
            ref: () => {},
            unref: () => {},
            kill: () => {},
          } as unknown as Deno.ChildProcess;
        }
      } as unknown as typeof Deno.Command;

      const result = await convertSvgToPng(SVG_RED);
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.reason, "convert-failed");
      }
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("convertSvgToPng — convert-failed", () => {
  it("returns ok:false reason:convert-failed with stderr when exit code != 0", async () => {
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeFailStub(
        "SVG parse error",
      );
      const result = await convertSvgToPng(SVG_RED);
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.reason, "convert-failed");
        assertEquals(typeof result.stderr, "string");
      }
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });

  it("convert-failed does NOT trigger the binary-missing handler (FR-022)", async () => {
    let handlerCallCount = 0;
    setBinaryMissingHandler(() => {
      handlerCallCount++;
    });
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeFailStub("parse error");
      await convertSvgToPng(SVG_RED);
      assertEquals(
        handlerCallCount,
        0,
        "convert-failed must not invoke the binary-missing handler",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("binary-missing handler fires exactly once per session (FR-021 / T027)", () => {
  it("handler is called once even when multiple SVG outputs trigger binary-missing", async () => {
    let handlerCallCount = 0;
    setBinaryMissingHandler(() => {
      handlerCallCount++;
    });
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeNotFoundStub();
      // Simulate multiple SVG outputs in the same session (multiple notebook opens)
      await convertSvgToPng(SVG_RED);
      await convertSvgToPng(SVG_BLUE);
      await convertSvgToPng(SVG_RED); // same as first
      assertEquals(
        handlerCallCount,
        1,
        "handler must fire exactly once even with multiple binary-missing detections",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("convertSvgToPng — cache hit", () => {
  it("returns immediately without spawning subprocess on same sha256 (SC-003)", async () => {
    let outputCount = 0;
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = class MockCommand {
        constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
        spawn(): Deno.ChildProcess {
          return makeFakeChild(0, MINIMAL_PNG, new Uint8Array(), () => {
            outputCount++;
          });
        }
      } as unknown as typeof Deno.Command;

      await convertSvgToPng(SVG_RED);
      await convertSvgToPng(SVG_RED); // same SVG → cache hit
      assertEquals(
        outputCount,
        1,
        "subprocess should only be invoked once for the same SVG",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("convertSvgToPng — LRU cap (SC-011)", () => {
  it("evicts entry 1 after 51 distinct inputs (LRU cap = 50)", async () => {
    let outputCount = 0;
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = class MockCommand {
        constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
        spawn(): Deno.ChildProcess {
          return makeFakeChild(0, MINIMAL_PNG, new Uint8Array(), () => {
            outputCount++;
          });
        }
      } as unknown as typeof Deno.Command;

      // Insert 51 distinct SVGs (fills cache and evicts the first entry)
      for (let i = 0; i < 51; i++) {
        await convertSvgToPng(
          `<svg viewBox="0 0 ${100 + i} 100"><circle r="${i}"/></svg>`,
        );
      }
      const afterFill = outputCount;

      // Entry i=0 was evicted; re-requesting it should spawn a new subprocess
      await convertSvgToPng(`<svg viewBox="0 0 100 100"><circle r="0"/></svg>`);
      assertEquals(
        outputCount,
        afterFill + 1,
        "evicted entry should trigger a new subprocess",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("__resetSvgCacheForTest", () => {
  it("clears cache so next call re-converts", async () => {
    let outputCount = 0;
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = class MockCommand {
        constructor(_cmd: string, _opts?: Deno.CommandOptions) {}
        spawn(): Deno.ChildProcess {
          return makeFakeChild(0, MINIMAL_PNG, new Uint8Array(), () => {
            outputCount++;
          });
        }
      } as unknown as typeof Deno.Command;

      await convertSvgToPng(SVG_RED);
      __resetSvgCacheForTest();
      await convertSvgToPng(SVG_RED);
      assertEquals(
        outputCount,
        2,
        "reset should clear cache so next call re-converts",
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });

  it("resets binaryMissingWarned so next NotFound triggers handler again", async () => {
    const origCommand = Deno.Command;
    let handlerCount = 0;
    setBinaryMissingHandler(() => {
      handlerCount++;
    });
    try {
      (Deno as Record<string, unknown>).Command = makeNotFoundStub();
      await convertSvgToPng(SVG_RED);
      assertEquals(handlerCount, 1);

      __resetSvgCacheForTest();
      await convertSvgToPng(SVG_RED);
      assertEquals(handlerCount, 2, "handler should fire again after reset");
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});

describe("subprocess args invariant (SC-008)", () => {
  it("spawns rsvg-convert with exactly ['--format=png'] and no dimension or dangerous flags", async () => {
    const captured = { args: [] as string[] };
    const origCommand = Deno.Command;
    try {
      (Deno as Record<string, unknown>).Command = makeSuccessStub(
        MINIMAL_PNG,
        captured,
      );
      await convertSvgToPng(SVG_RED);
      assertEquals(captured.args, ["--format=png"]);
      assertEquals(
        captured.args.some((a) => a.includes("--unlimited")),
        false,
      );
      assertEquals(captured.args.some((a) => a === "-u"), false);
      assertEquals(
        captured.args.some((a) => a.startsWith("-w") || a === "--width"),
        false,
      );
      assertEquals(
        captured.args.some((a) => a.startsWith("-h") || a === "--height"),
        false,
      );
    } finally {
      (Deno as Record<string, unknown>).Command = origCommand;
    }
  });
});
