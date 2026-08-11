---
name: code
description: Execute approved vertical slices from canonical timestamped docs/features tasks.html, slice by slice, using red-green-refactor TDD. Use after /todo has produced approved HTML-native tasks.
argument-hint: [feature-dir-or-slug]
---

# Implementation Phase

Execute approved vertical-slice tasks **one slice at a time** using strict red-green-refactor TDD. Each slice is a tracer bullet that cuts through every layer end-to-end. The AI writes both the tests and the implementation.

## Prerequisites

- An approved canonical `tasks.html` in a feature directory under `docs/features/`.
Resolve it from `$ARGUMENTS` (a path or slug), or with no argument find the most recent `docs/features/*/tasks.html` and confirm it is the right one.
- The user has explicitly approved the tasks (do not assume approval).
- The applicable context files and relevant ADRs have been read.

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions and canonical HTML synchronization rules. See [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) for how spec Testing Decisions and task Test surfaces determine where tests attach.

## Standing Authorization

Invoking `/code` (or selecting "AI implement" from `/build` Phase 4) is **standing authorization** for the routine TDD loop and everything it requires. You do NOT re-request approval between cycles, between slices, or before each file write. What proceeds without further confirmation:

- Writing the failing test, the minimal implementation, then refactoring.
- Reading any file in the working tree.
- Running tests, type checks, linters, formatters, build commands.
- Bringing up the project's documented dev services (per `AGENTS.md`, `README`, or `docker-compose.yml`) and activating its toolchain (`mise install`, `bundle install`, `npm ci`, `uv sync`, etc.) when tests can't load without them. Bootstrapping the harness is part of the TDD loop, not a separate decision.

What still requires explicit user input: a slice that cannot be implemented as written (surface it, then stop); destructive operations on artifacts the session did not author (force-push, schema drops, dataset deletions, `rm -rf` of user code); a genuine architectural fork with no signal in approved `mockups.html`, canonical `specs.html` / `tasks.html`, or the codebase. Asking "OK to proceed?" before each batch of writes is **not** how this skill works.

## TDD Protocol

Run strict vertical-slice TDD — see [../shared/references/tdd-protocol.md](../shared/references/tdd-protocol.md) for the philosophy and per-cycle rules, and [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) for deep-module test-surface decisions.

```
RED→GREEN: test1 → impl1   (one test, minimal code to pass)
RED→GREEN: test2 → impl2
(refactor between cycles, only while GREEN)
```

Use the `tdd-guide` agent (via the Agent tool) to guide each slice's cycle.

## Process

1. **Read context** — canonical `tasks.html`, its linked `specs.html`, approved `mockups.html` when present as Authoritative intent, applicable context files, and relevant ADRs. Use their ubiquitous language in tests and implementation.
2. **For each slice (dependency order)** — work one slice at a time; do NOT batch slices:
   - **Confirm the public interface** from the slice's Test surface and the spec's Testing Decisions (deep module: small interface, deep implementation). Do not ask whether tests are needed; derive the test seam from the shared testable-interface protocol.
   - **Tracer bullet** — write ONE end-to-end test through that interface → it fails (RED) → minimal code → it passes (GREEN).
   - **Incremental loop** — for each remaining acceptance criterion: one test → minimal code → GREEN.
   - **Refactor** (only while GREEN) — extract duplication, deepen modules; run tests after each step.
   - **Mark the slice complete** in `tasks.html` by changing each criterion's visible and `data-status` state and the slice's visible and `data-status` state to `complete`, then move on.
Stop only if a slice cannot be implemented as written.
3. **Verification loop** — after all slices, run type check, lint, full test suite, and build per [../shared/references/tooling.md](../shared/references/tooling.md). Fix failures (via TDD where applicable) until all pass.
4. **Post-implementation hygiene** — run the `refactorer` in hygiene mode on changed files through [../shared/references/implementation-hygiene.md](../shared/references/implementation-hygiene.md). Apply grep-verified SAFE cleanup, report higher-risk candidates, and rerun full verification after any edit. Final adversarial validation belongs to Review change, not implementation.

## Material UI Synchronization

Stop the affected slice when implementation feedback or a requested correction materially redesigns the approved UI.
Update canonical `mockups.html` and review the same artifact through `review-artifact` until it receives explicit approval, then synchronize `specs.html` and `tasks.html` with the approved design.
Renew each approval invalidated by the changed intent, including Spec or Tasks approval when its approved content changes.
Resume the affected slice only after the canonical artifacts and approvals are synchronized.

## Completion

Wrap up per [../shared/references/implementation-completion.md](../shared/references/implementation-completion.md) — report what was accomplished and surface the `/refactor` and `/review-code` pointers.

## Handling Issues

- **Minor issues:** fix and continue; note the deviation in the slice body.
- **A slice can't be implemented as written:** STOP and tell the user; wait for guidance.
  If the blocker is a missing or conflicting domain concept, recommend resolving it through `/model-domain` before changing approved intent.
- **Test failures during refactor:** revert the refactor step — refactoring must not change behavior.
- **Terse corrections after implementation** ("wider", "still cropped", "move this to the admin app"): act immediately only when the correction stays within approved UI intent and does not materially redesign the approved UI. A material redesign follows the Material UI Synchronization return path instead. When the user reverts, start fresh with the narrowed scope rather than patching a bad approach.
- **References to existing code** ("make it look like the users table"): read that reference and match it precisely. Most features are variations on existing patterns.
