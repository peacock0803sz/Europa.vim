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
}
