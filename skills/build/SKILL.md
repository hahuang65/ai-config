---
name: build
description: Full feature development workflow — grill the idea, draft a spec, break it into vertical-slice tasks, then implement via TDD (either AI or coached). Combines Matt Pocock's skills-TDD pipeline with annotation-cycle artifacts and visual HTML companions at each phase.
argument-hint: [feature-description]
disable-model-invocation: true
---

# Build Pipeline — Orchestrator

A disciplined 5-phase workflow for building features. Each phase is its own skill; run them in order, waiting for user approval between phases.

**Pipeline:** `/grill` → `/spec` → `/todo` → `/code` *(or `/coach`)* → `/review-code`

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for the approval gates, file conventions (`docs/features/<slug>/`), session management, and visual-sync rules every phase obeys. Read it first.

## Mandatory Phase Loading

`/build` is an orchestrator, not a replacement for the phase skills. At the start of each phase, **read that phase's `SKILL.md` by relative path and follow it**:

- Phase 1: [../grill/SKILL.md](../grill/SKILL.md)
- Phase 2: [../spec/SKILL.md](../spec/SKILL.md)
- Phase 3: [../todo/SKILL.md](../todo/SKILL.md)
- Phase 4a: [../code/SKILL.md](../code/SKILL.md)
- Phase 4b: [../coach/SKILL.md](../coach/SKILL.md)
- Phase 5: [../review-code/SKILL.md](../review-code/SKILL.md)
- HTML feedback support in Phases 2, 3, and 5: [../review-artifact/SKILL.md](../review-artifact/SKILL.md)

Do **not** decide whether a phase exists from the `available_skills` list or by interpreting names like "grill" as ordinary English. If this `/build` skill loaded, these phase files are part of the same installed skill bundle; load them directly by path. In harnesses without a skill-invocation tool, "invoke `<phase>`" means: read the phase `SKILL.md`, follow its linked references as needed, and execute its workflow.

Each phase also runs standalone:

- `/grill [topic]` — Phase 1: interview, refine `CONTEXT.md`, write ADRs
- `/spec [topic]` — Phase 2: synthesize canonical HTML from grilling and review it through `review-artifact`
- `/todo [spec-dir]` — Phase 3: vertical-slice tracer-bullet breakdown
- `/code [tasks-dir]` — Phase 4a: AI implements via TDD, slice by slice
- `/coach [tasks-dir]` — Phase 4b: user implements, AI writes one test at a time
- `/review-code [area]` — Phase 5: architectural review (standalone: entire codebase with no arguments, or the named area)

## Approval Gate Scope (read first)

This skill has exactly **four** approval gates — Grill→Spec, Spec→Tasks, Tasks→Implement, Review→done — the only points where you wait for user confirmation. (Implementation flows into the Phase 5 review without a gate; the final gate is the review's commit-or-iterate decision.) Within an active phase, all routine operations (reads, writes, edits, bash, tests, environment bootstrap) proceed without per-call approval. Asking "OK to proceed?" before each tool batch is not how this skill works.

A gate clears on **any response that expresses confirmation or approval** — there is no required phrase or keyword. The prompts below say what comes next; the user may confirm however they like ("yes", "go", "sounds good", "ship it", a thumbs-up). If a response is ambiguous or raises a concern, resolve it instead of advancing.

## Process

Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, max ~5 words). Run each phase skill in order, passing the feature directory once it is created (start of Phase 2).

### Phase 1: Grill

Load [../grill/SKILL.md](../grill/SKILL.md), then run `grill` with the feature description. It updates `CONTEXT.md` / `docs/adr/` project-wide and does NOT create the feature directory yet. After it completes, tell the user what was updated and:

> Ready to move on? Confirm and I'll synthesize what we discussed into the spec.

**Wait for the user to confirm before Phase 2.** This is a phase-boundary gate; within Phase 1 nothing else pauses.

### Phase 2: Spec + Review

Create the feature directory `docs/features/<YYYYMMDD-HHMM>-<slug>/`, then load [../spec/SKILL.md](../spec/SKILL.md) and run `spec` with the feature description and that path.
It writes the canonical `specs.html` and runs the [review artifact workflow](../shared/references/review-artifact.md) through `review-artifact`.
The user annotates rendered elements or text and sends messages; `spec` addresses every batch in the same HTML so the browser live-reloads the current artifact.

**Wait for an explicit browser approval or chat-fallback confirmation** — that approval *is* the Spec→Tasks gate.
No separate approval prompt follows; proceed straight to Phase 3.

### Phase 3: Tasks (vertical-slice tracer bullets)

Load [../todo/SKILL.md](../todo/SKILL.md), then run `todo` with the feature directory.
It reads `specs.html`, writes the canonical `tasks.html` with vertical slices and HITL/AFK metadata, then runs the same live review artifact workflow.

**Wait for explicit browser approval or chat-fallback confirmation** — that approval *is* the Tasks→Implement gate.
Then proceed to Phase 4.

### Phase 4: Implementation (vertical-slice TDD)

Ask which mode:

> - **`/code`** — AI implements the code via vertical-slice TDD (one test → one impl → repeat)
> - **`/coach`** — You implement; I write ONE test at a time and verify

If the user says "implement" or doesn't specify, load [../code/SKILL.md](../code/SKILL.md) and run `code` with the feature directory. If they say "coach me" or "guided", load [../coach/SKILL.md](../coach/SKILL.md) and run `coach`. Both run the same TDD philosophy, the verification loop, and the post-implementation review chain (`database-reviewer`, `refactorer` in hygiene mode, `code-reviewer`, `doc-updater`, `fact-checker`, `/visualize-diff`). After completion, report final status (slices, tests, verifications, visuals) and proceed straight to Phase 5 — no gate here.

### Phase 5: Code Review (architectural — the pipeline's final step)

Load [../review-code/SKILL.md](../review-code/SKILL.md), then run `review-code` scoped to **ONLY the changes** — the feature's diff against the branch point, never pre-existing code the feature didn't touch. The `architecture-reviewer` agent surfaces deepening candidates in the changed modules; the skill renders them as an HTML report and opens it through `review-artifact`.

**The report's explicit approval is the Review→done gate** — the user decides:

> Review's done — commit the feature as-is, or explore one of these findings first?

Committing (which the user does themselves — you never commit) ends the pipeline. Picking a finding enters review-code's grilling loop, and from there `/refactor` (scoped deepening) or a fresh `/build` round (interface-changing deepening).

## Key Principles

1. **Grill before drafting.** Pin terminology in `CONTEXT.md` first; codify decisions in ADRs.
2. **Never write code before tasks are approved.** Phases 1–3 are gated.
3. **Canonical semantic HTML files are the feature deliverables.** Do not create Markdown companions.
4. **Vertical slices, never horizontal.** Each slice cuts through every layer.
5. **Test stable public interfaces.** Use [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md): Spec proposes module test surfaces, tasks carry them forward, implementation writes one behavior test at a time through the seam.
6. **One test, one implementation, repeat.** No batched tests upfront.
7. **`CONTEXT.md` vocabulary everywhere** — spec, tasks, test names, code identifiers.

## Visual-Explainer Integration

The `visualize` skill is **optional** for informational visuals and diff review, but Phase 2 and Phase 3 still produce their required canonical semantic HTML artifacts.
When available it provides Mermaid diagrams, CSS-Grid layouts, styled tables, dark/light themes, zoom controls, and the standalone `/visualize-diff` command.
Whenever one of those HTML files asks the user for feedback or approval, open it through `review-artifact` rather than directly.

## Cleanup

After the feature is complete, the user decides whether to keep, delete, or commit the feature directory under `docs/features/`. `CONTEXT.md` and `docs/adr/` are project-wide and should be committed.
