/**
 * Bijection lint for `@spec-id` tags between spec files and TSDoc.
 *
 * Collects every `@spec-id europa.<area>.<topic>` occurrence from:
 *   - `tests/spec/**\/*_spec.ts`  (spec side)
 *   - `denops/europa/**\/*.ts`    (TSDoc / impl side)
 *
 * Fails if any ID appears on only one side, is duplicated, uses an
 * area outside the allowlist, or does not match the format regex.
 *
 * @module scripts/lint-spec-id-bijection
 * @spec-id europa.lint.spec-id-bijection.bijection
 */

const SPEC_ID_RE =
  /@spec-id\s+(europa\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2})/g;
const ID_FORMAT_RE =
  /^europa\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$/;

const AREA_ALLOWLIST = new Set([
  "notebook",
  "render",
  "view",
  "session",
  "capabilities",
  "config",
  "contract",
  "dispatcher",
  "commands",
  "lint",
  "main",
  // Phase 3.2 additions
  "kernel",
  "conformance",
  // Phase 3.3 additions (no new top-level areas; sub-areas below are governed by "kernel"
  // and "contract" which are already allowlisted):
  //   kernel.execute   — execute_request / iopub correlation / applyMessageToCell
  //   kernel.interrupt — REST POST /interrupt (Q3 default C)
  //   kernel.restart   — REST POST /restart + WebSocket re-open + kernel_info re-handshake
  //   kernel.correlation — parent_header.msg_id filter + pendingRequests state machine
  //   contract.dispatcher-phase3-3-alignment — runCell/runAll/interruptKernel/restartKernel/cancelCell TypeBox validation
  // Additional topics under existing areas:
  //   kernel.server-client.kernel-info-public — kernelInfo() DRY refactor (public method)
  //   session.state.{pending-requests-set,pending-requests-remove,exec-state-transition,cell-states-update}
  //   dispatcher.{run-cell,run-all,interrupt-kernel,restart-kernel,cancel-cell}
  //   config.kernel-info-timeout-defaults
  //   render.cell-exec-state-sign
  // Phase 3.4 additions (no new top-level areas; sub-areas below are governed by "render",
  // "session", and "dispatcher" which are already allowlisted):
  //   render.iopub-batch  — 16ms tick scheduler (queue-accumulate, tick-scheduling,
  //                         empty-tick-skip, reply-flush-immediate, close-flush-sync,
  //                         accumulate-during-flush, no-shed-no-drop)
  //   render.partial      — partial RenderPlan application (affected-cell-rerender,
  //                         above-cell-bit-identical, below-cell-line-offset-reattach)
  //   session.hidden-buffer — hidden buffer RPC skip + BufWinEnter resync
  //                           (rpc-skip-during-hidden, bufwinenter-resync, outputs-still-update)
  //   session.state.{iopub-batch-queue-set,iopub-batch-timer-set,iopub-batch-clear}
  //   dispatcher.{runcell-batch-driven,runall-batch-driven,cellops-flush-on-entry}
  // Phase 008 (undo/redo) additions — all under existing top-level areas:
  //   session.undo-history.{push,pop-undo,pop-redo,clear-redo,fifo-overflow,enqueue-undo,enqueue-redo,
  //     queue-overflow,empty-stack,sequential-processing,set-processor,push-undo-front,push-redo-front,dispose}
  //   session.state.{undo-history-init,undo-history-gc-on-bufwipeout,last-saved-snapshot-init}
  //   notebook.structural-snapshot.{take,restore-keep-outputs,restore-resurrect-empty-outputs,
  //     restore-keep-execution-count,restore-resurrect-null-execution-count}
  //   dispatcher.{europa-undo,europa-redo,europa-undo-render-failure,europa-redo-render-failure,
  //     europa-undo-scratch-dirty-refuse,europa-undo-empty-stack-warn,europa-redo-invalidate-on-mutation,
  //     europa-undo-affected-cell-cursor,europa-undo-iopub-flush}
  //   config.{undo-max-history-default,undo-max-history-out-of-range,disable-default-mappings-default}
]);

type Occurrence = { id: string; file: string; line: number };

// --- Argument parsing -------------------------------------------------------

const args = Deno.args;
function flagValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] ?? null : null;
}

const specRootOverride = flagValue("--spec-root");
const implRootOverride = flagValue("--impl-root");

const SPEC_ROOT = specRootOverride ?? "tests/spec";
const IMPL_ROOTS = implRootOverride
  ? [implRootOverride]
  : ["denops/europa", "scripts"];

// --- File walking -----------------------------------------------------------

async function walkTsFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const stat = await Deno.stat(root);
    if (stat.isFile && root.endsWith(".ts")) return [root];
    if (!stat.isDirectory) return [];
  } catch {
    return [];
  }
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await walkTsFiles(path)));
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

// --- ID collection ----------------------------------------------------------

async function collect(
  root: string,
  specFilter?: boolean,
): Promise<Occurrence[]> {
  const out: Occurrence[] = [];
  const files = await walkTsFiles(root);
  for (const file of files) {
    if (specFilter && !file.endsWith("_spec.ts")) continue;
    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      for (const m of line.matchAll(SPEC_ID_RE)) {
        out.push({ id: m[1], file, line: i + 1 });
      }
    }
  }
  return out;
}

// --- Bijection check --------------------------------------------------------

if (import.meta.main) {
  const specOccurrences = await collect(SPEC_ROOT, true);
  const tsdocOccurrences = (
    await Promise.all(IMPL_ROOTS.map((root) => collect(root, false)))
  ).flat();

  let failed = false;

  // Group by id
  const specById = new Map<string, Occurrence[]>();
  for (const o of specOccurrences) {
    const list = specById.get(o.id) ?? [];
    list.push(o);
    specById.set(o.id, list);
  }

  const implById = new Map<string, Occurrence[]>();
  for (const o of tsdocOccurrences) {
    const list = implById.get(o.id) ?? [];
    list.push(o);
    implById.set(o.id, list);
  }

  // Format check & area allowlist
  const allIds = new Set([...specById.keys(), ...implById.keys()]);
  const formatViolations: string[] = [];
  const areaViolations: string[] = [];

  for (const id of allIds) {
    if (!ID_FORMAT_RE.test(id)) {
      formatViolations.push(id);
    }
    const area = id.split(".")[1];
    if (!AREA_ALLOWLIST.has(area)) {
      areaViolations.push(id);
    }
  }

  if (formatViolations.length > 0) {
    failed = true;
    console.error("[europa.spec-id] format violations:");
    for (const id of formatViolations) console.error(`  ${id}`);
  }

  if (areaViolations.length > 0) {
    failed = true;
    console.error("[europa.spec-id] area not in allowlist:");
    for (const id of areaViolations) {
      const occ = [...(specById.get(id) ?? []), ...(implById.get(id) ?? [])];
      console.error(`  ${id}`);
      for (const o of occ) console.error(`    - ${o.file}:${o.line}`);
    }
  }

  // Strict bijection: each id must appear exactly once on each side.
  for (const [id, occs] of specById) {
    if (occs.length > 1) {
      failed = true;
      console.error(
        `[europa.spec-id] duplicate in spec: ${id} (${occs.length} occurrences)`,
      );
      for (const o of occs) console.error(`    - ${o.file}:${o.line}`);
    }
  }

  for (const [id, occs] of implById) {
    if (occs.length > 1) {
      failed = true;
      console.error(
        `[europa.spec-id] duplicate in impl: ${id} (${occs.length} occurrences)`,
      );
      for (const o of occs) console.error(`    - ${o.file}:${o.line}`);
    }
  }

  // Missing in impl (spec side only)
  const missingInImpl: Occurrence[] = [];
  for (const [id, occs] of specById) {
    if (!implById.has(id)) missingInImpl.push(...occs);
  }
  if (missingInImpl.length > 0) {
    failed = true;
    console.error(
      "[europa.spec-id] missing in TSDoc (defined in spec, not in impl):",
    );
    for (const o of missingInImpl) {
      console.error(`  ${o.id}`);
      console.error(`    - declared at ${o.file}:${o.line}`);
    }
  }

  // Missing in spec (impl side only)
  const missingInSpec: Occurrence[] = [];
  for (const [id, occs] of implById) {
    if (!specById.has(id)) missingInSpec.push(...occs);
  }
  if (missingInSpec.length > 0) {
    failed = true;
    console.error(
      "[europa.spec-id] missing in spec (defined in TSDoc, not in spec):",
    );
    for (const o of missingInSpec) {
      console.error(`  ${o.id}`);
      console.error(`    - declared at ${o.file}:${o.line}`);
    }
  }

  if (!failed) {
    const total = allIds.size;
    console.log(
      `[europa.spec-id] PASS — ${total} spec-id${
        total !== 1 ? "s" : ""
      } verified`,
    );
  }

  Deno.exit(failed ? 1 : 0);
}
