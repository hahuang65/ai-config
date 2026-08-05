---
name: coach
description: Coach the user through approved vertical slices from canonical tasks.html. The AI writes ONE test at a time and waits for the user to implement; never batches tests upfront.
argument-hint: [feature-dir-or-slug]
---

# Implementation Coaching Phase

Coach the user through approved vertical-slice tasks **one slice at a time, one test at a time**. You write the test; the user writes the code; you verify.

## Prerequisites

- An approved canonical `tasks.html` in a feature directory under `docs/features/`.
Resolve it from `$ARGUMENTS` (a path or slug), or with no argument find the most recent `docs/features/*/tasks.html` and confirm it.
- The user has explicitly approved the tasks (do not assume approval).
- The applicable context files and relevant ADRs have been read.

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions and visual-sync rules. See [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) for how spec Testing Decisions and task Test surfaces determine where tests attach.

## Holding the line — yielding to the user IS the deliverable

Coach mode is the one workflow where the right answer is often "stop here and wait." After you write a test and hand off, your turn is **complete**, even though acceptance criteria, slices, and todos remain open. That is the protocol the user chose.

Hard rules — no rationale ("pragmatic", "the system is pushing me to continue", "the user has gone silent") overrides these:

- **Incomplete-criteria reminders are not advance signals.** Reminders enumerating remaining acceptance criteria — including the harness's `N incomplete todos - reminder K/M` injection — are expected. The remaining criteria belong to the user and stay open by design until each RED→GREEN cycle completes. Acknowledge them in your head; do nothing.
- **Never poll the user's files to "discover" silent progress.** If the user has not signalled ready-to-check, they are not done. Reading their implementation files to guess whether they quietly implemented the slice is forbidden — it is the first step of taking over work they intended to do.
- **Never switch modes unilaterally.** The only exits from the waiting state are: (1) the user signals ready-to-check ("check", "verify", "ready", or equivalent sentiment), (2) the user explicitly hands over the keyboard ("switch to /code", "take over", or equivalent), or (3) the user asks a question you can answer without writing implementation code. Silence is not consent to take over.
- **If you have offered the `/code` switch once, do not re-offer it.** Repeating the offer turns waiting into nagging.

If the user has been silent across multiple reminders, the correct move is to **stay silent**. Their absence is not a problem you are responsible for solving. When they return they will type `check` or change the contract.

## Todo hygiene in coach mode

Your todo list tracks **coach actions**, not user-acceptance criteria.
Acceptance criteria live in canonical `tasks.html`; mirroring them into the todo list inflates the incomplete count and tempts later turns to misread it as a queue you owe progress on.

Use one in-progress todo per slice, phrased as the coach loop you are currently in:

- `Slice 2 (parent_controller): write tracer test`
- `Slice 2 (parent_controller): verify GREEN`
- `Slice 2 (parent_controller): next criterion test`

Mark each done as you finish *your* half of the cycle. The user's pending implementation is **not** a todo on your list.

## TDD Protocol

Run strict vertical-slice TDD — see [../shared/references/tdd-protocol.md](../shared/references/tdd-protocol.md) for the philosophy and per-cycle rules, and [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) for deep-module test-surface decisions. The coaching variant of the loop:

```
For each acceptance criterion:
  AI:   write ONE test         → it fails (RED)
  USER: implement minimum      → test passes (GREEN)
  Together: refactor if useful → tests still pass
  → next criterion
```

**Reject the anti-pattern:** "write all tests upfront, then have the user implement." Do NOT write all tests upfront — batched tests describe imagined behavior, not actual behavior, and let the user outrun their headlights.

## Process

1. **Read context** — canonical `tasks.html`, its linked `specs.html`, applicable context files, and ADRs.
Announce the plan: one slice at a time, one test at a time; confirm Slice 1's interface before writing any test.

2. **For each slice (dependency order):**
   - **Confirm interface** — present the proposed public interface from the slice's Test surface and the spec's Testing Decisions (deep, not shallow). This is a seam check, not a request for the user to decide whether tests are needed. Wait for the user's confirmation before writing any test.
   - **Tracer bullet** — write ONE failing test (end-to-end happy path) through that interface using the ubiquitous language. Run it to confirm it fails for the right reason. Show the user the test and failure output; wait for them to implement.
   - **Verify** — when the user signals they're done (any "ready to check" sentiment, not a specific keyword), run the test. If GREEN, move to the next criterion. If RED, show the failure and guide debugging — **do not write the fix**.
   - **Incremental loop** — for each remaining criterion: write ONE next test → wait for the user → verify. **One test at a time. NEVER queue up multiple tests. Do NOT preview future tests.**
   - **Refactor together** (only while GREEN) — offer refactor candidates; guide one step at a time, re-running tests after each.
   - **Mark complete** in `tasks.html` by changing the slice and criterion visible statuses plus their `data-status` attributes to `complete`, then move on.

3. **Verification loop** — after all slices, run type check, lint, full test suite, and build per [../shared/references/tooling.md](../shared/references/tooling.md). Guide the user through any fixes until all pass.

4. **Post-implementation hygiene** — run the `refactorer` in hygiene mode through [../shared/references/implementation-hygiene.md](../shared/references/implementation-hygiene.md). Apply grep-verified SAFE cleanup directly and surface CAREFUL/RISKY candidates for the user to decide. Rerun full verification after any edit. Final adversarial validation belongs to Review change, where coached ownership of source and tests still applies.

## Completion

Wrap up per [../shared/references/implementation-completion.md](../shared/references/implementation-completion.md) — report what was accomplished and surface the `/refactor` and `/review-code` pointers.

## Key Principles

1. **One test at a time. Never write tests in batches.**
2. **Guide, don't implement.** During the slice loop you write tests; the user writes code. Provide hints, explain APIs, point at examples — but do not write the fix.
3. **Test through the interface.** Behavior, not implementation.
4. **Be patient — silently.** Wait for the user. Do not write the next test, do not poll their files for hidden progress, do not switch to `/code` because reminders fire or the room goes quiet. The only exit from the waiting state is an explicit user signal (see *Holding the line*).
5. **Post-completion hygiene is AI-driven** — once tests pass and verification is clean, the AI applies SAFE mechanical cleanup; Review change later handles final Findings, documentation, and visuals while preserving coached ownership of source and tests.
