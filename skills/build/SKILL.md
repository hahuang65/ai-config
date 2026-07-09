---
name: build
description: Full feature development workflow — grill the idea, draft a spec, break it into vertical-slice tasks, then implement via TDD (either AI or coached). Combines Matt Pocock's skills-TDD pipeline with annotation-cycle artifacts and visual HTML companions at each phase.
argument-hint: [feature-description]
disable-model-invocation: true
---

# Build Pipeline — Orchestrator

A disciplined 5-phase workflow for building features. Each phase is its own skill; run them in order, waiting for user approval between phases.

**Pipeline:** `/grill` → `/specs` → `/tasks` → `/implement` *(or `/implement-coach`)* → `/review-code`

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for the approval gates, file conventions (`docs/features/<slug>/`), session management, and visual-sync rules every phase obeys. Read it first.

## Mandatory Phase Loading

`/build` is an orchestrator, not a replacement for the phase skills. At the start of each phase, **read that phase's `SKILL.md` by relative path and follow it**:

- Phase 1: [../grill/SKILL.md](../grill/SKILL.md)
- Phase 2: [../specs/SKILL.md](../specs/SKILL.md)
- Phase 3: [../tasks/SKILL.md](../tasks/SKILL.md)
- Phase 4a: [../implement/SKILL.md](../implement/SKILL.md)
- Phase 4b: [../implement-coach/SKILL.md](../implement-coach/SKILL.md)
- Phase 5: [../review-code/SKILL.md](../review-code/SKILL.md)

Do **not** decide whether a phase exists from the `available_skills` list or by interpreting names like "grill" as ordinary English. If this `/build` skill loaded, these phase files are part of the same installed skill bundle; load them directly by path. In harnesses without a skill-invocation tool, "invoke `<phase>`" means: read the phase `SKILL.md`, follow its linked references as needed, and execute its workflow.

Each phase also runs standalone:

- `/grill [topic]` — Phase 1: interview, refine `CONTEXT.md`, write ADRs
- `/specs [topic]` — Phase 2: synthesize spec from grilling, with annotation cycles
- `/tasks [specs-dir]` — Phase 3: vertical-slice tracer-bullet breakdown
- `/implement [tasks-dir]` — Phase 4a: AI implements via TDD, slice by slice
- `/implement-coach [tasks-dir]` — Phase 4b: user implements, AI writes one test at a time
- `/review-code [area]` — Phase 5: architectural review (standalone: entire codebase with no arguments, or the named area)

## Approval Gate Scope (read first)

This skill has exactly **four** approval gates — Grill→Spec, Spec→Tasks, Tasks→Implement, Review→done — the only points where you wait for user confirmation. (Implementation flows into the Phase 5 review without a gate; the final gate is the review's commit-or-iterate decision.) Within an active phase, all routine operations (reads, writes, edits, bash, tests, environment bootstrap) proceed without per-call approval. Asking "OK to proceed?" before each tool batch is not how this skill works. (oh-my-pi: see `~/.omp/agent/RULES.md`, "Approval gates are user-facing only".)

A gate clears on **any response that expresses confirmation or approval** — there is no required phrase or keyword. The prompts below say what comes next; the user may confirm however they like ("yes", "go", "sounds good", "ship it", a thumbs-up). If a response is ambiguous or raises a concern, resolve it instead of advancing.

## Process

Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, max ~5 words). Run each phase skill in order, passing the feature directory once it is created (start of Phase 2).

### Phase 1: Grill

Load [../grill/SKILL.md](../grill/SKILL.md), then run `grill` with the feature description. It updates `CONTEXT.md` / `docs/adr/` project-wide and does NOT create the feature directory yet. After it completes, tell the user what was updated and:

> Ready to move on? Confirm and I'll synthesize what we discussed into the spec.

**Wait for the user to confirm before Phase 2.** This is a phase-boundary gate; within Phase 1 nothing else pauses.

### Phase 2: Spec + Review

Create the feature directory `docs/features/<YYYYMMDD-HHMM>-<slug>/`, then load [../specs/SKILL.md](../specs/SKILL.md) and run `specs` with the feature description and that path. It writes `spec.md`, generates and opens `spec.html`, and runs the artifact review (see [../shared/references/artifact-review.md](../shared/references/artifact-review.md)): the user gives feedback — `//` annotations or direct answers — which `specs` addresses and re-presents (the visual isn't regenerated mid-review), or confirms. On confirmation `specs` regenerates `spec.html` once if the markdown changed.

**Wait for the user to confirm in that review** — their confirmation *is* the spec→Tasks gate. No separate approval prompt; when they confirm rather than keep reviewing, proceed straight to Phase 3.

### Phase 3: Tasks (vertical-slice tracer bullets)

Load [../tasks/SKILL.md](../tasks/SKILL.md), then run `tasks` with the feature directory. It breaks the spec into vertical slices with HITL/AFK markers, writes `tasks.md`, generates and opens `tasks.html`, runs the same review (no mid-review regen), and regenerates `tasks.html` once on confirmation if the markdown changed.

**Wait for the user to confirm in that review** — their confirmation *is* the Tasks→Implement gate. Then proceed to Phase 4.

### Phase 4: Implementation (vertical-slice TDD)

Ask which mode:

> - **`/implement`** — AI implements the code via vertical-slice TDD (one test → one impl → repeat)
> - **`/implement-coach`** — You implement; I write ONE test at a time and verify

If the user says "implement" or doesn't specify, load [../implement/SKILL.md](../implement/SKILL.md) and run `implement` with the feature directory. If they say "coach me" or "guided", load [../implement-coach/SKILL.md](../implement-coach/SKILL.md) and run `implement-coach`. Both run the same TDD philosophy, the verification loop, and the post-implementation review chain (`database-reviewer`, `refactorer` in hygiene mode, `code-reviewer`, `doc-updater`, `fact-checker`, `/diff-review`). After completion, report final status (slices, tests, verifications, visuals) and proceed straight to Phase 5 — no gate here.

### Phase 5: Code Review (architectural — the pipeline's final step)

Load [../review-code/SKILL.md](../review-code/SKILL.md), then run `review-code` scoped to **ONLY the changes** — the feature's diff against the branch point, never pre-existing code the feature didn't touch. The `architecture-reviewer` agent surfaces deepening candidates in the changed modules; the skill renders them as an HTML report.

**The report is the Review→done gate** — the user decides:

> Review's done — commit the feature as-is, or explore one of these findings first?

Committing (which the user does themselves — you never commit) ends the pipeline. Picking a finding enters review-code's grilling loop, and from there `/refactor` (scoped deepening) or a fresh `/build` round (interface-changing deepening).

## Key Principles

1. **Grill before drafting.** Pin terminology in `CONTEXT.md` first; codify decisions in ADRs.
2. **Never write code before tasks are approved.** Phases 1–3 are gated.
3. **Markdown files are the deliverables.** Visual HTML pages are companions.
4. **Vertical slices, never horizontal.** Each slice cuts through every layer.
5. **Test stable public interfaces.** Use [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md): Spec proposes module test surfaces, tasks carry them forward, implementation writes one behavior test at a time through the seam.
6. **One test, one implementation, repeat.** No batched tests upfront.
7. **`CONTEXT.md` vocabulary everywhere** — spec, tasks, test names, code identifiers.

## Visual-Explainer Integration

The `visual-explainer` skill is **optional** — all visual steps are skipped gracefully if it is not installed. When available it produces self-contained HTML (Mermaid diagrams, CSS-Grid layouts, styled tables, dark/light themes, zoom controls), generates the per-phase companions (`spec.html`, `tasks.html`, `diff-review.html`), and exposes these standalone commands: `/diff-review`, `/plan-review`, `/project-recap`. It also activates proactively for complex terminal tables (4+ rows or 3+ columns), rendering an HTML table instead.

## Cleanup

After the feature is complete, the user decides whether to keep, delete, or commit the feature directory under `docs/features/`. `CONTEXT.md` and `docs/adr/` are project-wide and should be committed.
