/**
 * MockChildProcess, MockCommandConfig, and MockCommandRegistry for
 * simulating Deno.Command / subprocess behaviour in tests.
 *
 * Phase 3.2: extracted from mock-host.ts
 *
 * @module tests/fixtures/mock-process
 */

// ---------------------------------------------------------------------------
// MockCommandConfig
// ---------------------------------------------------------------------------

/** Options for controlling mock subprocess behavior in tests. */
export type MockCommandConfig = {
  stdoutLines?: string[];
  stderrLines?: string[];
  exitCode?: number;
  /** Delay in ms between emitting stdout lines (simulates slow startup). */
  lineDelayMs?: number;
};

// ---------------------------------------------------------------------------
// MockChildProcess
// ---------------------------------------------------------------------------

/**
 * Simulated child process returned by MockCommand.spawn().
 *
 * `stdout` is a ReadableStream that emits the configured lines, then closes.
 * `status` resolves after stdout is exhausted.
 */
export class MockChildProcess {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly status: Promise<{ code: number; success: boolean }>;

  private _killed = false;
  private _killSignal: string | undefined;

  constructor(config: MockCommandConfig = {}) {
    const lines = config.stdoutLines ?? [];
    const errLines = config.stderrLines ?? [];
    const exitCode = config.exitCode ?? 0;
    const delay = config.lineDelayMs ?? 0;

    const enc = new TextEncoder();

    // Resolve `status` only after stdout finishes streaming so callers awaiting
    // process exit do not race with `lineDelayMs`-throttled output.
    let stdoutDone!: () => void;
    const stdoutFinished = new Promise<void>((r) => {
      stdoutDone = r;
    });

    this.stdout = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const line of lines) {
          if (delay > 0) {
            await new Promise<void>((r) => setTimeout(r, delay));
          }
          controller.enqueue(enc.encode(line + "\n"));
        }
        controller.close();
        stdoutDone();
      },
    });

    this.stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of errLines) {
          controller.enqueue(enc.encode(line + "\n"));
        }
        controller.close();
      },
    });

    this.status = stdoutFinished.then(() => ({
      code: exitCode,
      success: exitCode === 0,
    }));
  }

  kill(signal?: string): void {
    this._killed = true;
    this._killSignal = signal;
  }

  get wasKilled(): boolean {
    return this._killed;
  }

  get killSignal(): string | undefined {
    return this._killSignal;
  }
}

// ---------------------------------------------------------------------------
// MockCommandRegistry
// ---------------------------------------------------------------------------

/**
 * Registry of MockCommand factories, keyed by executable name pattern.
 *
 * Install before tests that call server-process.ts or watchdog.ts, then
 * check `.calls` to verify the subprocess was spawned with expected args.
 */
export class MockCommandRegistry {
  readonly calls: Array<{ program: string | URL; args: string[]; opts: unknown }> = [];
  private readonly _factories = new Map<string, (args: string[]) => MockChildProcess>();

  register(program: string, factory: (args: string[]) => MockChildProcess): void {
    this._factories.set(program, factory);
  }

  /** Create a MockCommand that records calls and delegates to registered factory. */
  create(
    program: string | URL,
    opts?: { args?: string[] },
  ): { spawn(): MockChildProcess } {
    const args = opts?.args ?? [];
    this.calls.push({ program, args, opts });
    const key = typeof program === "string" ? program : program.toString();
    const factory = this._factories.get(key);
    return {
      spawn: () => factory ? factory(args) : new MockChildProcess(),
    };
  }

  reset(): void {
    this.calls.length = 0;
    this._factories.clear();
  }
}
