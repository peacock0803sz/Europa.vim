/**
 * Minimal global stub for the `Deno` namespace used by TypeDoc generation.
 *
 * The real Deno globals are provided by the runtime; tsc / TypeDoc do not
 * load them automatically. This file declares only the APIs referenced from
 * `denops/europa/**` so the build-time check passes without pulling the full
 * `@types/deno` package.
 *
 * No top-level `import` or `export` here — keeping the file as a script makes
 * `declare namespace Deno` ambient/global rather than module-scoped.
 */

declare namespace Deno {
  function readTextFile(path: string | URL): Promise<string>;
  function makeTempFile(options?: { suffix?: string }): Promise<string>;
  function writeFile(path: string, data: Uint8Array): Promise<void>;
  function writeTextFile(path: string, data: string): Promise<void>;

  const build: { os: "darwin" | "linux" | "windows" };

  class Command {
    constructor(
      cmd: string,
      options?: {
        args?: string[];
        stdin?: string;
        stdout?: string;
        stderr?: string;
      },
    );
    output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
    spawn(): {
      stdin: {
        getWriter(): {
          write(data: Uint8Array): Promise<void>;
          close(): Promise<void>;
        };
      };
      output(): Promise<
        { code: number; stdout: Uint8Array; stderr: Uint8Array }
      >;
    };
  }
}
