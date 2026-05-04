/**
 * Denops-shaped mock for use in BDD specs.
 *
 * Records all calls to `cmd`, `call`, `eval`, and `dispatch` into an
 * in-memory log. Supports switching `meta.host` between "vim" and "nvim".
 * Buffer lines and prop/extmark state are tracked as simple maps.
 *
 * Phase 3.1 writable mode adds:
 *   - bufadd / bufload / bwipeout / bufnr / bufexists
 *   - getbufline / setbufline / appendbufline / deletebufline
 *   - getbufvar / setbufvar (option state per buffer)
 *   - autocmd.define / autocmd.remove / autocmd.fire (group registry)
 *   - cursor / getcurpos / currentBufnr
 *   - dispatcher notify/request mock
 *
 * Phase 3.2 adds:
 *   - MockWebSocket — unit-test WebSocket logic without a real server
 *   - MockCommand / MockChildProcess — simulate Deno.Command for subprocess tests
 *   - VimLeavePre event support in autocmd.fire
 *
 * @module tests/fixtures/mock-host
 */

import type { Denops, Dispatcher, Meta } from "@denops/std";

export type CallRecord = {
  method: "cmd" | "call" | "eval" | "dispatch" | "batch";
  args: unknown[];
};

export type MockHostOptions = {
  host?: "vim" | "nvim";
  hostVersion?: string;
};

/** Per-buffer state tracked by the writable mock. */
type BufState = {
  lines: string[];
  vars: Map<string, unknown>;
  exists: boolean;
  loaded: boolean;
};

export class MockHost implements Denops {
  readonly name = "europa";
  readonly meta: Meta;
  readonly log = console;
  // Required by Denops interface (deprecated plugin state bag)
  readonly context: Record<PropertyKey, unknown> = {};
  // Mutable dispatcher map — set by main.ts at init time
  dispatcher: Dispatcher = {};

  calls: CallRecord[] = [];

  /** Simulated buffer lines: bufnr → lines */
  bufLines: Map<number, string[]> = new Map();
  /** Simulated evaluated values: expression → return value */
  evalValues: Map<string, unknown> = new Map();
  /** Vim text properties: type → list of prop records */
  props: Map<string, unknown[]> = new Map();
  /** Neovim extmarks: namespace id (from nvim_create_namespace) */
  namespaces: Map<string, number> = new Map();
  private _nextNsId = 1;

  // --- Phase 3.1 writable mode ---

  /** Full buffer state (replaces the simpler bufLines map for writable mode). */
  private _buffers: Map<number, BufState> = new Map();
  private _nextBufnr = 100;
  /** bufname → bufnr */
  private _bufnames: Map<string, number> = new Map();
  /** autocmd groups: groupName → list of { event, pattern, command } */
  private _autocmdGroups: Map<
    string,
    Array<{ event: string; pattern: string; command: string }>
  > = new Map();
  /** Current active buffer number (for bufnr('%') mock). */
  currentBufnr = 1;
  /** cursor position [lnum, col] (1-origin). */
  cursorPos: [number, number] = [1, 1];
  /** bufnr → list of winids displaying that buffer (for win_findbuf mock). */
  windowsHavingBuf: Map<number, number[]> = new Map();

  /** Fired VimLeavePre autocmd callbacks (registered by tests). */
  private _vimLeavePreCallbacks: Array<() => void | Promise<void>> = [];

  /** Autocmd helpers accessible from tests. */
  readonly autocmd = {
    define: (
      group: string,
      event: string,
      pattern: string,
      command: string,
    ) => {
      const entries = this._autocmdGroups.get(group) ?? [];
      entries.push({ event, pattern, command });
      this._autocmdGroups.set(group, entries);
    },
    remove: (group: string) => {
      this._autocmdGroups.delete(group);
    },
    /**
     * Fire an autocmd event. VimLeavePre dispatches every callback registered
     * via onVimLeavePre(); other events are currently no-ops.
     */
    fire: async (event: string, _bufnr: number): Promise<void> => {
      if (event === "VimLeavePre") {
        await this.fireVimLeavePre();
      }
    },
    has: (group: string) => this._autocmdGroups.has(group),
    get: (group: string) => this._autocmdGroups.get(group) ?? [],
  };

  /** Trigger VimLeavePre — simulates Vim exiting; calls all registered callbacks. */
  async fireVimLeavePre(): Promise<void> {
    // Real Vim runs every VimLeavePre autocmd regardless of individual failures.
    // Mirror that: don't short-circuit when one callback rejects.
    await Promise.allSettled(this._vimLeavePreCallbacks.map((cb) => cb()));
  }

  /** Register a VimLeavePre callback (used by session/events.ts mock integration). */
  onVimLeavePre(cb: () => void | Promise<void>): void {
    this._vimLeavePreCallbacks.push(cb);
  }

  constructor(opts: MockHostOptions = {}) {
    this.meta = {
      host: opts.host ?? "vim",
      version: opts.hostVersion ?? (opts.host === "nvim" ? "0.11.3" : "9.1.1646"),
      platform: "linux",
      mode: "release",
    };
  }

  cmd(command: string, _ctx?: unknown): Promise<void> {
    this.calls.push({ method: "cmd", args: [command] });
    // Simulate nvim_create_namespace returning an id
    if (command.startsWith("nvim_create_namespace")) {
      const m = command.match(/nvim_create_namespace\(['"](.+)['"]\)/);
      if (m) {
        const name = m[1];
        if (!this.namespaces.has(name)) {
          this.namespaces.set(name, this._nextNsId++);
        }
      }
    }
    // cursor(lnum, col) — update simulated cursor position
    const cursorMatch = command.match(/call cursor\((\d+),\s*(\d+)\)/);
    if (cursorMatch) {
      this.cursorPos = [parseInt(cursorMatch[1]), parseInt(cursorMatch[2])];
    }
    // augroup … | au! | augroup END — remove the group
    const augroupClear = command.match(/augroup\s+(\S+).*\|.*au!/s);
    if (augroupClear) {
      this._autocmdGroups.delete(augroupClear[1]);
    }
    return Promise.resolve();
  }

  call(fn: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "call", args: [fn, ...args] });

    // --- Phase 2 mocks (preserved) ---
    if (fn === "prop_type_list") return Promise.resolve([]);
    if (fn === "nvim_create_namespace") {
      const name = args[0] as string;
      if (!this.namespaces.has(name)) {
        this.namespaces.set(name, this._nextNsId++);
      }
      return Promise.resolve(this.namespaces.get(name)!);
    }
    if (fn === "bufnr") {
      const expr = args[0];
      if (expr === "%") return Promise.resolve(this.currentBufnr);
      if (typeof expr === "string") {
        const n = this._bufnames.get(expr);
        return Promise.resolve(n ?? -1);
      }
      return Promise.resolve(1);
    }
    if (fn === "bufwinid") return Promise.resolve(1000);
    if (fn === "screenpos") {
      const lnum = args[1] as number;
      return Promise.resolve({ row: lnum, col: 1, endcol: 1, curscol: 1 });
    }

    // --- Phase 3.1 buffer lifecycle mocks ---
    if (fn === "bufadd") {
      const name = args[0] as string;
      if (this._bufnames.has(name)) {
        return Promise.resolve(this._bufnames.get(name)!);
      }
      const nr = this._nextBufnr++;
      this._bufnames.set(name, nr);
      this._buffers.set(nr, {
        lines: [],
        vars: new Map(),
        exists: true,
        loaded: false,
      });
      return Promise.resolve(nr);
    }
    if (fn === "bufload") {
      const nr = args[0] as number;
      const buf = this._buffers.get(nr);
      if (buf) buf.loaded = true;
      return Promise.resolve(null);
    }
    if (fn === "bwipeout" || fn === "bwipeout!") {
      const nr = args[0] as number;
      const buf = this._buffers.get(nr);
      if (buf) {
        buf.exists = false;
        buf.loaded = false;
      }
      // Remove reverse name mapping
      for (const [name, n] of this._bufnames) {
        if (n === nr) {
          this._bufnames.delete(name);
          break;
        }
      }
      return Promise.resolve(null);
    }
    if (fn === "bufexists") {
      const nr = args[0] as number;
      return Promise.resolve(this._buffers.get(nr)?.exists ? 1 : 0);
    }
    if (fn === "getbufline") {
      const nr = args[0] as number;
      const from = (args[1] as number) - 1; // 1-origin → 0-origin
      const to = args[2] === "$"
        ? (this._buffers.get(nr)?.lines.length ?? 0)
        : (args[2] as number);
      const lines = this._buffers.get(nr)?.lines ?? [];
      return Promise.resolve(lines.slice(from, to));
    }
    if (fn === "setbufline") {
      const nr = args[0] as number;
      const lnum = (args[1] as number) - 1; // 1-origin → 0-origin
      const newLines = Array.isArray(args[2])
        ? args[2] as string[]
        : [args[2] as string];
      let buf = this._buffers.get(nr);
      if (!buf) {
        buf = { lines: [], vars: new Map(), exists: true, loaded: true };
        this._buffers.set(nr, buf);
      }
      // Extend if needed
      while (buf.lines.length < lnum) buf.lines.push("");
      buf.lines.splice(lnum, newLines.length, ...newLines);
      // Also keep the legacy bufLines map in sync
      this.bufLines.set(nr, buf.lines);
      return Promise.resolve(null);
    }
    if (fn === "appendbufline") {
      const nr = args[0] as number;
      const lnum = args[1] === "$"
        ? (this._buffers.get(nr)?.lines.length ?? 0)
        : (args[1] as number);
      const newLines = Array.isArray(args[2])
        ? args[2] as string[]
        : [args[2] as string];
      let buf = this._buffers.get(nr);
      if (!buf) {
        buf = { lines: [], vars: new Map(), exists: true, loaded: true };
        this._buffers.set(nr, buf);
      }
      buf.lines.splice(lnum, 0, ...newLines);
      this.bufLines.set(nr, buf.lines);
      return Promise.resolve(null);
    }
    if (fn === "deletebufline") {
      const nr = args[0] as number;
      const from = (args[1] as number) - 1;
      const to = args[2] === "$"
        ? (this._buffers.get(nr)?.lines.length ?? 0)
        : (args[2] as number);
      const buf = this._buffers.get(nr);
      if (buf) {
        buf.lines.splice(from, to - from);
        this.bufLines.set(nr, buf.lines);
      }
      return Promise.resolve(null);
    }
    if (fn === "getbufvar") {
      const nr = args[0] as number;
      const varName = args[1] as string;
      const buf = this._buffers.get(nr);
      if (!buf) return Promise.resolve(args[2] ?? null);
      const val = buf.vars.get(varName);
      return Promise.resolve(val !== undefined ? val : (args[2] ?? null));
    }
    if (fn === "setbufvar") {
      const nr = args[0] as number;
      const varName = args[1] as string;
      const value = args[2];
      let buf = this._buffers.get(nr);
      if (!buf) {
        buf = { lines: [], vars: new Map(), exists: true, loaded: false };
        this._buffers.set(nr, buf);
      }
      buf.vars.set(varName, value);
      return Promise.resolve(null);
    }
    if (fn === "getcurpos") {
      return Promise.resolve([0, this.cursorPos[0], this.cursorPos[1], 0, this.cursorPos[1]]);
    }
    if (fn === "win_execute") {
      // win_execute(winid, cmd) — just record, return empty
      return Promise.resolve("");
    }
    if (fn === "win_findbuf") {
      const bufnr = args[0] as number;
      return Promise.resolve(this.windowsHavingBuf.get(bufnr) ?? []);
    }
    if (fn === "win_gotoid") {
      // Recorded by the generic call log; no state change needed.
      return Promise.resolve(1);
    }
    if (fn === "writefile") return Promise.resolve(0);
    if (fn === "chansend") return Promise.resolve(1);

    return Promise.resolve(null);
  }

  eval(expr: string): Promise<unknown> {
    this.calls.push({ method: "eval", args: [expr] });
    if (this.evalValues.has(expr)) {
      return Promise.resolve(this.evalValues.get(expr));
    }
    // Return the Vim default embedded in get(g:, 'europa_<key>', <default>)
    const getMatch = expr.match(/^get\(g:,\s*'europa_[^']+',\s*([\s\S]+)\)$/);
    if (getMatch) {
      const literal = getMatch[1].trim();
      if (literal === "v:true") return Promise.resolve(true);
      if (literal === "v:false") return Promise.resolve(false);
      try {
        return Promise.resolve(JSON.parse(literal));
      } catch {
        return Promise.resolve(null);
      }
    }
    if (expr === "g:europa_image_backend") return Promise.resolve("auto");
    // exists() — return 0 by default (var does not exist)
    if (expr.startsWith("exists(")) return Promise.resolve(0);
    return Promise.resolve(null);
  }

  dispatch(name: string, fn: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "dispatch", args: [name, fn, ...args] });
    // Forward to the registered dispatcher if available
    if (name === this.name && this.dispatcher[fn]) {
      return Promise.resolve(
        (this.dispatcher[fn] as (...a: unknown[]) => unknown)(...args),
      );
    }
    return Promise.resolve(null);
  }

  batch(..._calls: unknown[]): Promise<unknown[]> {
    this.calls.push({ method: "batch", args: _calls });
    return Promise.resolve([]);
  }

  redraw(_force?: boolean): Promise<void> {
    return Promise.resolve();
  }

  /** Set an eval expression return value for testing. */
  setEval(expr: string, value: unknown): void {
    this.evalValues.set(expr, value);
  }

  /** Get all lines of a buffer. */
  getBufLines(nr: number): string[] {
    return this._buffers.get(nr)?.lines ?? this.bufLines.get(nr) ?? [];
  }

  /** Get a buffer variable. */
  getBufVar(nr: number, varName: string): unknown {
    return this._buffers.get(nr)?.vars.get(varName);
  }

  /** Check if a buffer exists in the writable state map. */
  hasBuf(nr: number): boolean {
    return this._buffers.get(nr)?.exists ?? false;
  }

  /** Reset call log and state. */
  reset(): void {
    this.calls = [];
    this.bufLines.clear();
    this.evalValues.clear();
    this.props.clear();
    this.namespaces.clear();
    this._nextNsId = 1;
    this._buffers.clear();
    this._bufnames.clear();
    this._autocmdGroups.clear();
    this._nextBufnr = 100;
    this.currentBufnr = 1;
    this.cursorPos = [1, 1];
    this.windowsHavingBuf.clear();
    this._vimLeavePreCallbacks = [];
  }

  /** Find all calls to a given function name. */
  callsTo(fn: string): CallRecord[] {
    return this.calls.filter(
      (c) => c.method === "call" && c.args[0] === fn,
    );
  }

  /** Find all cmd calls matching a substring. */
  cmdsMatching(substr: string): CallRecord[] {
    return this.calls.filter(
      (c) => c.method === "cmd" && String(c.args[0]).includes(substr),
    );
  }
}

/** Create a MockHost configured for Vim. */
export function mockVim(version = "9.1.1646"): MockHost {
  return new MockHost({ host: "vim", hostVersion: version });
}

/** Create a MockHost configured for Neovim. */
export function mockNvim(version = "0.11.3"): MockHost {
  return new MockHost({ host: "nvim", hostVersion: version });
}

// ---------------------------------------------------------------------------
// Phase 3.2: MockWebSocket
// ---------------------------------------------------------------------------

/** Server-side controller exposed by MockWebSocket for test orchestration. */
export interface MockWebSocketServer {
  /** Complete the WebSocket handshake with the given subprotocol. */
  accept(protocol: string): void;
  /** Push a text or binary message to the client listener. */
  receive(data: string | ArrayBuffer): void;
  /** Trigger a close event on the client side. */
  close(code?: number, reason?: string): void;
  /** Trigger an error event on the client side. */
  error(): void;
  /** All data frames sent by the client via ws.send(). */
  readonly sentData: ReadonlyArray<string | ArrayBuffer>;
}

/**
 * Minimal WebSocket lookalike for unit testing WebSocket-dependent code.
 *
 * Exposes a `server` controller so tests can simulate server-side events
 * (accept/receive/close/error) without a real TCP connection.
 *
 * Usage:
 *   const ws = new MockWebSocket("ws://localhost:8888/channels", ["v1.kernel..."]);
 *   ws.addEventListener("open", () => { ... });
 *   ws.server.accept("v1.kernel.websocket.jupyter.org");
 */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  protocol = "";
  readonly url: string;
  readonly requestedProtocols: string[];

  private readonly _listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private readonly _sentData: Array<string | ArrayBuffer> = [];

  readonly server: MockWebSocketServer;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.requestedProtocols = Array.isArray(protocols)
      ? protocols
      : protocols
      ? [protocols]
      : [];

    // deno-lint-ignore no-this-alias
    const self = this;
    this.server = {
      accept(protocol: string): void {
        self.protocol = protocol;
        self.readyState = MockWebSocket.OPEN;
        self._dispatch(new Event("open"));
      },
      receive(data: string | ArrayBuffer): void {
        self._dispatch(new MessageEvent("message", { data }));
      },
      close(code = 1000, reason = ""): void {
        self.readyState = MockWebSocket.CLOSED;
        self._dispatch(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
      },
      error(): void {
        self._dispatch(new Event("error"));
      },
      get sentData(): ReadonlyArray<string | ArrayBuffer> {
        return self._sentData;
      },
    };
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this._listeners.get(type) ?? new Set();
    set.add(listener);
    this._listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this._listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer): void {
    this._sentData.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === MockWebSocket.OPEN || this.readyState === MockWebSocket.CONNECTING) {
      this.readyState = MockWebSocket.CLOSING;
      this.server.close(code, reason);
    }
  }

  private _dispatch(event: Event): void {
    for (const listener of this._listeners.get(event.type) ?? []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3.2: MockCommand / MockChildProcess
// ---------------------------------------------------------------------------

/** Options for controlling mock subprocess behavior in tests. */
export type MockCommandConfig = {
  stdoutLines?: string[];
  stderrLines?: string[];
  exitCode?: number;
  /** Delay in ms between emitting stdout lines (simulates slow startup). */
  lineDelayMs?: number;
};

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
