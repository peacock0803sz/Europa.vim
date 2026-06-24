# Contributing to Europa.vim

This document covers contributor mechanics: development setup, the `deno task` pipeline, the editing rules for `doc/europa-<slug>.txt`, and the `@spec-id` linkage between BDD specs and TSDoc. For architecture, read `DESIGN.md`; the English version is authoritative and `DESIGN.ja.md` is the synchronized translation.

## 1. Introduction

Europa.vim is a denops-based Vim/Neovim plugin that orbits Jupyter for viewing — and eventually editing — `.ipynb` notebooks. It targets Vim 9.1.1646+ and Neovim 0.11.3+, runs every TypeScript file under Deno, and keeps the host Python-free. The plugin connects to Jupyter via REST + WebSocket (Phase 3) and ZeroMQ (Phase 4, opt-in), with `.ipynb` as the wire format.

A three-tier Source-of-Truth model governs the project. TypeBox schemas under `schema/` are the SoT for data shape, BDD specs under `tests/spec/` for behavior, and TSDoc plus the hand-written guide chapters for documentation. Inferred TS types, JSON Schema, and `doc/europa.txt` are recomputed from the upper tiers and are never hand-edited.

## 2. Requirements

- Nix with flakes enabled. Provides `deno`, `pandoc`, `nodejs`, and `typos`.
- Vim 9.1.1646+ or Neovim 0.11.3+, needed only for running the plugin end-to-end.
- A `jupyter` command on the host. Auto-detected via `.venv/`, `venv/`, `VIRTUAL_ENV`, or `CONDA_PREFIX`. See `DESIGN.md` chapter 6.5.

Europa.vim does not install Python packages. Bring your own `jupyter_server` and `ipykernel`.

## 3. Setup

```sh
git clone https://github.com/peacock0803sz/Europa.vim.git
cd Europa.vim
nix develop                 # boots the dev shell with deno / pandoc / nodejs / typos
deno cache deno.json        # warms the Deno module cache (first run only)
pre-commit install          # registers the git hook
```

`deno task check` should pass on a fresh clone after this.

## 4. Development workflow

```text
git switch -c <feature>
nix develop
... edit ...
pre-commit run --files <changed>     # or rely on the auto-installed hook
deno task check                          # full local CI pass before pushing
git push -u origin HEAD
gh pr create ...                      # see section 8 for PR conventions
```

Every PR declares its phase in the description; section 8 covers the format. Phase 1 is the current target. From Phase 2 onward, every implementation lands together with a BDD spec under `tests/spec/`.

## 5. deno tasks

| Task | Purpose | Phase |
|------|---------|-------|
| `deno task check` | Full local CI: `deno fmt --check`, `deno task lint`, `deno task gen:vimdoc`, and `git diff --exit-code doc/europa.txt`. Must pass before opening a PR. | Phase 0+ |
| `deno task lint` | Runs `deno lint` and `scripts/lint-no-handwritten-types.ts`. Phase 1 enforces only the `docs/` prohibition; Phase 2 adds the AST-based hand-written-type and comment-quality rules. | Phase 1+ |
| `deno task gen:vimdoc` | Runs `scripts/concat-md.ts` (passthrough scaffold in Phase 1) and emits `doc/europa-api.txt`. Re-running yields a zero diff. The hand-written guide chapters under `doc/europa-<slug>.txt` are not touched. | Phase 0+ |
| `deno task smoke:ipynb` | Runs the Phase 0 nbformat-v4 smoke test against `tests/fixtures/hello.ipynb`. | Phase 0+ |
| `deno task test:spec` | Runs BDD specs under `tests/spec/`. | Phase 2+ |
| `deno task test:golden` | Runs golden-file diffs for `.ipynb` fixtures and `doc/europa.txt`. | Phase 2+ |
| `deno task test:conformance` | Runs end-to-end conformance tests under `tests/conformance/` against a real `jupyter server`. Requires `pip install 'jupyter-server>=2.15,<3.0' 'ipykernel>=7.0,<8.0'`. Not included in `deno task check` (Q5 decision). | Phase 3.2+ |

## 6. Guide chapter editing rules

Each user-facing chapter ships as its own help file under `doc/europa-<slug>.txt` in vim help format. Vim/Neovim's `:helptags` scans `doc/` recursively, so keeping a separate sources directory inside `doc/` would produce duplicate-tag errors; the chapters themselves are the source of truth and are loaded directly. Only `doc/europa-api.txt` is generated, by `deno task gen:vimdoc` from TSDoc.

- Edit `doc/europa-<slug>.txt` directly. The slug is kebab-case English; canonical chapters are `introduction`, `requirements`, `setup`, `configuration`, `commands`, `mappings`, `examples`, `kernel`, `faq`, `about`, plus the auto-generated `api`.
- `doc/europa.txt` is the hand-written index. When you add a new chapter file, add a `|europa-<slug>|` line to that index in the same change.
- Never hand-edit `doc/europa-api.txt`. Run `deno task gen:vimdoc` to regenerate it; CI fails on a non-zero `git diff --exit-code doc/europa-api.txt`.
- Every chapter carries a primary tag of the form `*europa-<slug>*` matching the filename slug. Sub-section tags follow `*europa-<slug>-<subsection>*`. Tags must not collide with `doc/denops.txt`, which ships its own namespace.
- Every chapter ends with the standard vim help modeline `vim:tw=78:ts=8:noet:ft=help:norl:`.
- Files are UTF-8 with LF line endings.

## 7. `@spec-id` operation

BDD specs and TSDoc are linked via `@spec-id`, never via heading names. Heading-name matching is forbidden because it breaks under renames and translations.

- The ID format is `europa.<area>.<topic>`, for example `europa.notebook.parse.normalize`. The area matches the `denops/europa/<area>/` directory; the topic names the function or behavior.
- On the spec side, attach a TSDoc block carrying `@spec-id europa.<area>.<topic>` to the `describe()` or top-level test for that scenario in `tests/spec/**/*.ts`.
- On the implementation side, the matching TSDoc block on the function or class embeds the same `@spec-id`.
- A CI gate planned for Phase 2 verifies the bijection between IDs in `tests/spec/**` and IDs in implementation TSDoc; missing or duplicated IDs fail the build.

Phase 1 establishes the operational rule only. The lint that enforces the bijection lands in Phase 2 alongside the rest of the in-house lint suite, rules 1 and 2 of `scripts/lint-no-handwritten-types.ts`.

### Active `@spec-id` areas (Phase 3.3)

Phase 3.3 adds the following areas and topics to the allowlist in `scripts/lint-spec-id-bijection.ts`:

| Area | Topics added in Phase 3.3 |
|------|--------------------------|
| `kernel.execute` | `request-msg-id-unique`, `iopub-stream`, `execute-result`, `error-content`, `execute-reply-ok`, `execute-reply-error`, `abort-mid-stream`, `wire-message-count`, `conformance-*` |
| `kernel.interrupt` | `rest-204`, `idle-no-op`, `reconnect-mid`, `token-header`, `conformance-running` |
| `kernel.restart` | `rest-200`, `websocket-reopen`, `kernel-info-resync`, `5xx-fallback`, `exec-count-reset`, `conformance-state-reset` |
| `kernel.correlation` | `cross-buffer-drop`, `pending-state-queued-to-sent`, `pending-remove-on-reply`, `parent-header-filter` |
| `kernel.server-client` | `kernel-info-public` (topic added to existing area) |
| `contract` | `dispatcher-phase3-3-alignment` |
| `session.state` | `pending-requests-set`, `pending-requests-remove`, `exec-state-transition`, `cell-states-update` |
| `dispatcher` | `run-cell`, `run-cell-queued-on-busy`, `run-all`, `interrupt-kernel`, `restart-kernel`, `cancel-cell`, `conformance-cancel-queued` |
| `config` | `kernel-info-timeout-defaults` |
| `render` | `cell-exec-state-sign` (topic added to existing area) |

### Active `@spec-id` areas (Phase 3.8 — error traceback line jump)

Phase 3.8 introduces the following spec-ids covering the renderError parser extension, the viewer-side jump executor, the dispatcher RPC pair, and the per-viewer warn-once autocmd:

| Area | Topics added in Phase 3.8 |
|------|--------------------------|
| `render.traceback` | `parse.ipython8` |
| `view.traceback-jump` | `cell-line`, `external-file`, `missing-detection` |
| `dispatcher` | `jump-to-traceback`, `jump-to-traceback-list` |
| `session.state` | `kernel-runtime-cwd` |
| `session.events` | `jump-warned-reset` |

## 8. Commit and PR conventions

- Documentation, in-code comments, and commit subjects are written in English.
- Commit messages follow the `.github/.gitmessage` template. Each subject opens with an emoji prefix and stays at or under 72 columns; the body explains the why.
- The PR body is paragraph-per-line; do not hard-wrap inside a paragraph, since GitHub renders the wraps as line breaks.

## 9. Debugging and reporting issues

Reproduce bugs with `sample.vimrc` at the repository root before reporting them. It loads `denops.vim` and Europa.vim itself — plus `capture.vim` if installed — and enables `g:denops#debug` and `g:denops#trace`.

`capture.vim` is optional. `sample.vimrc` skips it when the directory is missing. Install it when you want to dump `:messages` to a file and attach the log to an issue.

Set `VIM_PLUGINS_DIR` to the directory containing the plugin checkouts, then launch:

```sh
VIM_PLUGINS_DIR=~/.local/share/nvim/lazy nvim -u sample.vimrc ./tests/fixtures/hello.ipynb
```

A GitHub issue should include the reproduction steps on `sample.vimrc`, the Vim or Neovim version from `:version`, the terminal emulator and its version, and the `:messages` output after the failure. Attach a `capture.vim` dump when the bug involves denops trace output.

## 10. License and contact

The project is distributed under the license described in `LICENCE` at the repository root. Open issues and pull requests on GitHub at `peacock0803sz/Europa.vim`. Security-sensitive reports go through the private security advisory mechanism on the same repository.
