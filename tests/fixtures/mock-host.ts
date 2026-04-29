/**
 * Denops-shaped mock for use in BDD specs.
 *
 * Records all calls to `cmd`, `call`, `eval`, and `dispatch` into an
 * in-memory log. Supports switching `meta.host` between "vim" and "nvim".
 * Buffer lines and prop/extmark state are tracked as simple maps.
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
    return Promise.resolve();
  }

  call(fn: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "call", args: [fn, ...args] });
    // Simulate specific function return values
    if (fn === "prop_type_list") return Promise.resolve([]);
    if (fn === "nvim_create_namespace") {
      const name = args[0] as string;
      if (!this.namespaces.has(name)) {
        this.namespaces.set(name, this._nextNsId++);
      }
      return Promise.resolve(this.namespaces.get(name)!);
    }
    if (fn === "bufnr") return Promise.resolve(1);
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
      try {
        return Promise.resolve(JSON.parse(getMatch[1]));
      } catch {
        return Promise.resolve(null);
      }
    }
    if (expr === "g:europa_image_backend") return Promise.resolve("auto");
    return Promise.resolve(null);
  }

  dispatch(name: string, fn: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "dispatch", args: [name, fn, ...args] });
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

  /** Reset call log and state. */
  reset(): void {
    this.calls = [];
    this.bufLines.clear();
    this.evalValues.clear();
    this.props.clear();
    this.namespaces.clear();
    this._nextNsId = 1;
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
