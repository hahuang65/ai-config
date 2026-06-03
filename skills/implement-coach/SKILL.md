---
name: implement-coach
description: Coach the user through implementing approved vertical-slice tasks. The AI writes ONE test at a time and waits for the user to implement; never batches tests upfront. Use after /tasks has produced an approved tasks.md and the user wants to write the code themselves.
argument-hint: [feature-dir-or-slug]
---

# Implementation Coaching Phase

Coach the user through approved vertical-slice tasks **one slice at a time, one test at a time**. You write the test; the user writes the code; you verify.

## Prerequisites

- An approved `tasks.md` in a feature directory under `docs/features/`. Resolve it from `$ARGUMENTS` (a path or slug), or — with no argument — find the most recent `docs/features/*/tasks.md` and confirm it.
- The user has explicitly approved the tasks (do not assume approval).
- `CONTEXT.md` and relevant ADRs have been read so test names use the project's vocabulary.

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions and visual-sync rules.

## Rules Adherence

Comply with the project rules in `rules/`. In Claude Code these are global instructions; in omp, load via `rule://<name>` when entering the rule's domain. Guide the user to follow them while implementing.

## TDD Protocol

Run strict vertical-slice TDD — see [../shared/references/tdd-protocol.md](../shared/references/tdd-protocol.md) for the philosophy, per-cycle rules, per-slice checklist, and deep-modules guidance. The coaching variant of the loop:

```
For each acceptance criterion:
  AI:   write ONE test         → it fails (RED)
  USER: implement minimum      → test passes (GREEN)
  Together: refactor if useful → tests still pass
  → next criterion
```

**Reject the anti-pattern:** "write all tests upfront, then have the user implement." Do NOT write all tests upfront — batched tests describe imagined behavior, not actual behavior, and let the user outrun their headlights.

## Process

1. **Read context** — `tasks.md`, the linked `prd.md`, `CONTEXT.md`, ADRs. Announce the plan: one slice at a time, one test at a time; confirm Slice 1's interface before writing any test.

2. **For each slice (dependency order):**
   - **Confirm interface** — present the proposed public interface (deep, not shallow). Wait for the user's confirmation before writing any test.
   - **Tracer bullet** — write ONE failing test (end-to-end happy path) using the public interface and `CONTEXT.md` vocabulary. Run it to confirm it fails for the right reason. Show the user the test and failure output; wait for them to implement.
   - **Verify** — when the user signals they're done (any "ready to check" sentiment, not a specific keyword), run the test. If GREEN, move to the next criterion. If RED, show the failure and guide debugging — **do not write the fix**.
   - **Incremental loop** — for each remaining criterion: write ONE next test → wait for the user → verify. **One test at a time. NEVER queue up multiple tests. Do NOT preview future tests.**
   - **Refactor together** (only while GREEN) — offer refactor candidates; guide one step at a time, re-running tests after each.
   - **Mark complete** in `tasks.md` (check off criteria, append `**Status:** ✅ Complete`), then move on.

3. **Verification loop** — after all slices, run type check, lint, full test suite, and build per [../shared/references/tooling.md](../shared/references/tooling.md). Guide the user through any fixes until all pass.

4. **Post-implementation review chain** — run the steps in [../shared/references/review-chain.md](../shared/references/review-chain.md): `database-reviewer` (conditional), `code-cleaner`, `refactor-cleaner`, `code-reviewer`, `doc-updater` (conditional), `fact-checker`, visual refresh, `/diff-review`. **Coaching rule:** surface findings and guide the user to fix the ones they own (the implementation code) — apply mechanical cleanup, documentation, and visuals directly yourself.

## Completion

Wrap up per [../shared/references/implementation-completion.md](../shared/references/implementation-completion.md) — report what was accomplished, surface the `/refactor` and `/improve-codebase` pointers, and never commit.

## Key Principles

1. **One test at a time. Never write tests in batches.**
2. **Guide, don't implement.** During the slice loop you write tests; the user writes code. Provide hints, explain APIs, point at examples — but do not write the fix.
3. **Test through the interface.** Behavior, not implementation.
4. **Be patient.** Wait for the user; don't write the next test before the current one is green.
5. **`CONTEXT.md` vocabulary everywhere** — test names, helper names, error messages.
6. **Post-completion cleanup is AI-driven** — once tests pass and verification is clean, the AI handles cleanup, docs, and visuals directly; `database-reviewer` / `code-reviewer` findings are the exception (surfaced and guided, since the user owns the code).
7. **NEVER commit to version control** — no `git add`, `git commit`, or `git push`.

Ultrathink.
