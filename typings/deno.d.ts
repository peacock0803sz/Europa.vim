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

interface ImportMeta {
  main?: boolean;
}

declare namespace Deno {
  // Filesystem
  function readTextFile(path: string | URL): Promise<string>;
  function makeTempFile(options?: { suffix?: string }): Promise<string>;
  function writeFile(path: string, data: Uint8Array): Promise<void>;
  function writeTextFile(path: string, data: string): Promise<void>;
  function readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  function remove(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  function realPath(path: string): Promise<string>;
  function cwd(): string;

  // Process
  const pid: number;
  const args: string[];
  function execPath(): string;
  function exit(code?: number): never;
  function kill(pid: number, signame: string): void;
  function addSignalListener(signal: string, handler: () => void): void;

  // Environment
  const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };

  // Build info
  const build: { os: "darwin" | "linux" | "windows" };

  // Errors namespace
  const errors: {
    NotFound: new (message?: string) => Error;
    PermissionDenied: new (message?: string) => Error;
    NotCapable: new (message?: string) => Error;
  };

  // ChildProcess returned by Command.spawn()
  interface ChildProcess {
    readonly pid: number;
    readonly status: Promise<{ code: number; success: boolean }>;
    readonly stdin: {
      getWriter(): {
        write(data: Uint8Array): Promise<void>;
        close(): Promise<void>;
      };
    };
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    kill(signame?: string): void;
    output(): Promise<{
      code: number;
      success: boolean;
      stdout: Uint8Array;
      stderr: Uint8Array;
    }>;
  }

  // Network
  interface NetAddr {
    transport: "tcp" | "udp";
    hostname: string;
    port: number;
  }
  interface Listener {
    readonly addr: NetAddr;
    close(): void;
  }
  function listen(options: {
    port: number;
    hostname?: string;
    transport?: "tcp";
  }): Listener;

  class Command {
    constructor(
      cmd: string,
      options?: {
        args?: string[];
        cwd?: string;
        stdin?: string;
        stdout?: string;
        stderr?: string;
        env?: Record<string, string>;
      },
    );
    output(): Promise<{
      code: number;
      success: boolean;
      stdout: Uint8Array;
      stderr: Uint8Array;
    }>;
    spawn(): ChildProcess;
  }
}
