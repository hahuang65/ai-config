---
name: implement
description: Execute approved vertical-slice tasks from docs/features/<slug>/tasks.md, slice by slice, using red-green-refactor TDD. Use after /tasks has produced an approved tasks.md.
argument-hint: [feature-dir-or-slug]
---

# Implementation Phase

Execute approved vertical-slice tasks **one slice at a time** using strict red-green-refactor TDD. Each slice is a tracer bullet that cuts through every layer end-to-end. The AI writes both the tests and the implementation.

## Prerequisites

- An approved `tasks.md` in a feature directory under `docs/features/`. Resolve it from `$ARGUMENTS` (a path or slug), or — with no argument — find the most recent `docs/features/*/tasks.md` and confirm it's the right one.
- The user has explicitly approved the tasks (do not assume approval).
- `CONTEXT.md` and any relevant ADRs have been read so test and module names match the project's vocabulary.

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions and visual-sync rules.

## Rules Adherence

Comply with the project rules in `rules/` (coding-style, testing, security, performance, git-commit). In Claude Code these are global instructions; in pi, read from `~/.pi/agent/rules/`; in oh-my-pi, load via `rule://<name>` when entering the rule's domain. The skill itself — not just the agents it invokes — must follow them.

## Standing Authorization

Invoking `/implement` (or selecting "AI implement" from `/build` Phase 4) is **standing authorization** for the routine TDD loop and everything it requires. You do NOT re-request approval between cycles, between slices, or before each file write. What proceeds without further confirmation:

- Writing the failing test, the minimal implementation, then refactoring.
- Reading any file in the working tree.
- Running tests, type checks, linters, formatters, build commands.
- Bringing up the project's documented dev services (per `AGENTS.md`, `README`, or `docker-compose.yml`) and activating its toolchain (`mise install`, `bundle install`, `npm ci`, `uv sync`, etc.) when tests can't load without them. Bootstrapping the harness is part of the TDD loop, not a separate decision.

What still requires explicit user input: a slice that cannot be implemented as written (surface it, then stop); destructive operations on artifacts the session did not author (force-push, schema drops, dataset deletions, `rm -rf` of user code); a genuine architectural fork with no signal in `prd.md` / `tasks.md` / the codebase. Asking "OK to proceed?" before each batch of writes is **not** how this skill works.

## TDD Protocol

Run strict vertical-slice TDD — see [../shared/references/tdd-protocol.md](../shared/references/tdd-protocol.md) for the philosophy, per-cycle rules, per-slice checklist, and deep-modules guidance.

```
RED→GREEN: test1 → impl1   (one test, minimal code to pass)
RED→GREEN: test2 → impl2
(refactor between cycles, only while GREEN)
```

Use the `tdd-guide` agent (via the Agent tool) to guide each slice's cycle.

## Process

1. **Read context** — `tasks.md`, the linked `prd.md`, `CONTEXT.md`, and relevant ADRs.
2. **For each slice (dependency order)** — work one slice at a time; do NOT batch slices:
   - **Confirm the public interface** (deep module: small interface, deep implementation).
   - **Tracer bullet** — write ONE end-to-end test → it fails (RED) → minimal code → it passes (GREEN).
   - **Incremental loop** — for each remaining acceptance criterion: one test → minimal code → GREEN.
   - **Refactor** (only while GREEN) — extract duplication, deepen modules; run tests after each step.
   - **Mark the slice complete** in `tasks.md` (check off criteria, append `**Status:** ✅ Complete`), then move on. Stop only if a slice can't be implemented as written.
3. **Verification loop** — after all slices, run type check, lint, full test suite, and build per [../shared/references/tooling.md](../shared/references/tooling.md). Fix failures (via TDD where applicable) until all pass.
4. **Post-implementation review chain** — run the `database-reviewer` (conditional), `code-cleaner`, `refactor-cleaner`, `code-reviewer`, `doc-updater` (conditional), `fact-checker`, visual refresh, and `/diff-review` steps in [../shared/references/review-chain.md](../shared/references/review-chain.md). In AI mode you fix CRITICAL/HIGH findings directly.

## Completion

Wrap up per [../shared/references/implementation-completion.md](../shared/references/implementation-completion.md) — report what was accomplished, surface the `/refactor` and `/improve-codebase` pointers, and never commit.

## Handling Issues

- **Minor issues:** fix and continue; note the deviation in the slice body.
- **A slice can't be implemented as written:** STOP and tell the user; wait for guidance.
- **Test failures during refactor:** revert the refactor step — refactoring must not change behavior.
- **Terse corrections after implementation** ("wider", "still cropped", "move this to the admin app"): act immediately — you have full context from the PRD and tasks. When the user reverts, start fresh with the narrowed scope rather than patching a bad approach.
- **References to existing code** ("make it look like the users table"): read that reference and match it precisely. Most features are variations on existing patterns.

Ultrathink.
