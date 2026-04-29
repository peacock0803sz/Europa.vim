# Contributing to Europa.vim

This document covers contributor mechanics: development setup, the `deno task` pipeline, the editing rules for `doc/sources/*.txt`, and the `@spec-id` linkage between BDD specs and TSDoc. For architecture, read `DESIGN.md`; the English version is authoritative and `DESIGN.ja.md` is the synchronized translation.

## 1. Introduction

Europa.vim is a denops-based Vim/Neovim plugin for viewing — and eventually editing — Jupyter `.ipynb` notebooks. It targets Vim 9.1.1646+ and Neovim 0.11.3+, and runs every TypeScript file under Deno.

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

`deno task ci` should pass on a fresh clone after this.

## 4. Development workflow

```text
git switch -c <feature>
nix develop
... edit ...
pre-commit run --files <changed>     # or rely on the auto-installed hook
deno task ci                          # full local CI pass before pushing
git push -u origin HEAD
gh pr create ...                      # see section 8 for PR conventions
```

Every PR declares its phase in the description; section 8 covers the format. Phase 1 is the current target. From Phase 2 onward, every implementation lands together with a BDD spec under `tests/spec/`.

## 5. deno tasks

| Task | Purpose | Phase |
|------|---------|-------|
| `deno task ci` | Full local CI: `deno fmt --check`, `deno task lint`, `deno task gen:vimdoc`, and `git diff --exit-code doc/europa.txt`. Must pass before opening a PR. | Phase 0+ |
| `deno task lint` | Runs `deno lint` and `scripts/lint-no-handwritten-types.ts`. Phase 1 enforces only the `docs/` prohibition; Phase 2 adds the AST-based hand-written-type and comment-quality rules. | Phase 1+ |
| `deno task gen:vimdoc` | Runs `scripts/concat-md.ts` (passthrough scaffold in Phase 1) and emits `doc/europa.txt`. Re-running yields a zero diff. | Phase 0+ |
| `deno task smoke:ipynb` | Runs the Phase 0 nbformat-v4 smoke test against `tests/fixtures/hello.ipynb`. | Phase 0+ |
| `deno task test:spec` | Will run BDD specs under `tests/spec/`, wired up in Phase 2. | Phase 2+ (planned) |
| `deno task test:golden` | Will run golden-file diffs for `.ipynb` fixtures and `doc/europa.txt`, wired up in Phase 2. | Phase 2+ (planned) |

## 6. Guide chapter editing rules

User-facing chapters live under `doc/sources/*.txt` in vim help format. The aggregated `doc/europa.txt` is generated; never hand-edit it.

- Edit only `doc/sources/<NN>-<slug>.txt`. Run `deno task gen:vimdoc` and commit both files in the same change.
- The filename pattern is `<NN>-<slug>.txt`. The two-digit prefix orders chapters; `01`–`08` cover the canonical chapters and `99` closes with About. The slug is kebab-case English.
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

## 8. Commit and PR conventions

- Documentation, in-code comments, and commit subjects are written in English.
- Commit messages follow the `.gitmessage` template. Each subject opens with an emoji prefix and stays at or under 72 columns; the body explains the why.
- Every PR declares its phase, `Phase 0`–`Phase 5`. Mixing phases in one PR is rejected.
- Once the bijection check lands in Phase 2, every PR lists the `@spec-id` values it covers. Phase 1 PRs are exempt and say so in the description, pointing to `plan.md` Complexity Tracking for the active feature.
- The PR body is paragraph-per-line; do not hard-wrap inside a paragraph, since GitHub renders the wraps as line breaks.

## 9. License and contact

The project is distributed under the license described in `LICENCE` at the repository root. Open issues and pull requests on GitHub at `peacock0803sz/Europa.vim`. Security-sensitive reports go through the private security advisory mechanism on the same repository.
