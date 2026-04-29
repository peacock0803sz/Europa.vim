/**
 * Minimal type stub for \@denops/std used by TypeDoc generation.
 *
 * The real package lives on JSR (jsr:\@denops/std) and is resolved at runtime
 * by Deno. TypeDoc uses Node.js module resolution and cannot reach JSR, so
 * this stub provides just enough type information to let TypeDoc generate docs
 * without errors. skipLibCheck is enabled so library internals are not
 * re-validated.
 */

export interface Denops {
  readonly name: string;
  readonly meta: Meta;
  readonly context: Record<PropertyKey, unknown>;
  dispatcher: Dispatcher;
  cmd(command: string, ctx?: unknown): Promise<void>;
  call(fn: string, ...args: unknown[]): Promise<unknown>;
  eval(expr: string): Promise<unknown>;
  dispatch(name: string, fn: string, ...args: unknown[]): Promise<unknown>;
  batch(...calls: unknown[]): Promise<unknown[]>;
  redraw(force?: boolean): Promise<void>;
}

export interface Meta {
  readonly host: "vim" | "nvim";
  readonly version: string;
  readonly platform: "linux" | "darwin" | "windows";
  readonly mode: "release" | "debug" | "test";
}

export type Dispatcher = Record<
  string,
  (...args: unknown[]) => Promise<unknown>
>;
