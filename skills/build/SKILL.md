---
name: build
description: Full feature development workflow — grill the idea, draft a PRD, break it into vertical-slice tasks, then implement via TDD (either AI or coached). Combines Matt Pocock's skills-TDD pipeline with annotation-cycle artifacts and visual HTML companions at each phase.
argument-hint: [feature-description]
disable-model-invocation: true
---

# Build - Full Workflow

A disciplined 4-phase workflow for building features with AI assistance. Each phase produces persistent artifacts: project-wide docs (`CONTEXT.md`, `docs/adr/`) get refined during grilling, and feature-specific docs (PRD, tasks, diff-review) live in `docs/claude/<slug>/`.

**Pipeline**: `/grill` → `/prd` → `/tasks` → `/implement` *(or `/implement-coach`)*

This skill orchestrates four sub-skills. You can also use each phase independently:

- `/grill [topic]` — Phase 1: interview, refine `CONTEXT.md`, write ADRs
- `/prd [topic]` — Phase 2: synthesize PRD from grilling, with annotation cycles
- `/tasks [prd-dir]` — Phase 3: vertical-slice tracer-bullet breakdown
- `/implement [tasks-dir]` — Phase 4a: AI implements via TDD, slice by slice
- `/implement-coach [tasks-dir]` — Phase 4b: user implements, AI writes one test at a time

Visual-explainer companions are also available standalone (see "Visual-Explainer Integration Notes" below).

## Approval Gate Scope (read first)

This skill names exactly **four** approval gates: Grill→PRD, PRD→Tasks, Tasks→Implement, Implement→done. Those are the only points where you wait for user confirmation.

Within an active phase, all routine operations proceed without per-call approval — reads, writes, edits, bash, tests, environment bootstrap. Announcing intended tool batches and asking "OK to proceed?" before each one is not how this skill works.

If you find yourself appealing to a meta-policy that requires per-call confirmation, you are wrong. See `~/.omp/agent/RULES.md` ("Approval gates are user-facing only").

---

## File Naming Convention

Project-wide artifacts live at the repo root and accrete across many `/build` runs:

```
/
├── CONTEXT.md                      # shared glossary (refined by /grill)
└── docs/
    └── adr/                        # Architectural Decision Records (added by /grill)
        ├── 0001-event-sourced-orders.md
        └── 0002-postgres-for-write-model.md
```

Feature-specific artifacts go in a per-feature directory:

```
docs/claude/<YYYYMMDD-HHMM>-<slug>/
  prd.md             # Phase 2 output
  prd.html           # Phase 2 visual companion
  tasks.md           # Phase 3 output
  tasks.html         # Phase 3 visual companion
  diff-review.html   # Phase 4 visual companion
```

Note: there is no `research.md` or `plan.md` in the new pipeline. Grilling does its own ad-hoc codebase exploration; the PRD replaces the old plan format.

To generate the per-feature directory:

1. Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp via `date +%Y%m%d-%H%M`
3. Create the directory: `docs/claude/<timestamp>-<slug>/`

This directory is created once at the start of Phase 2 (the first phase that writes feature-specific artifacts) and reused across Phases 2–4. When sub-skills are invoked, pass the directory path so they write into it.

---

## Phase 1: Grill

Invoke the `grill` skill to interview the user about the feature, sharpen domain terminology, and update `CONTEXT.md` / `docs/adr/` inline.

Use the Skill tool to invoke `grill` with the feature description from `$ARGUMENTS`.

The grilling session updates project-wide files. It does NOT create the feature directory yet — that happens in Phase 2.

After the grill phase completes, STOP and tell the user:

> **Phase 1 complete.** I've updated:
> - `CONTEXT.md` with <n> term(s): <list>
> - `docs/adr/` with <n> new ADR(s): <list>
>   *(or "no new ADRs — none of today's decisions met the bar")*
>
> Say **"draft the PRD"** when you're ready and I'll synthesize what we discussed.

**Wait for the user to confirm before proceeding to Phase 2.** This is a phase-boundary gate — within Phase 1, all reads, writes, and bash calls proceed without per-call approval. The pause is only here, between phases.

---

## Phase 2: PRD + Annotation Cycles

Once the user confirms, invoke the `prd` skill.

Before invoking, create the per-feature directory `docs/claude/<timestamp>-<slug>/` and pass it to the sub-skill.

Use the Skill tool to invoke `prd` with the feature description and the feature directory path.

The `prd` skill will handle:

1. Reading `CONTEXT.md`, recent ADRs, and prior conversation
2. Sketching the major modules (deep-modules philosophy) and confirming them with the user
3. Writing `prd.md` with user stories, decisions, testing notes — no code snippets, no file paths
4. Generating `prd.html` alongside the markdown
5. Waiting for `//` annotations
6. Addressing all annotations and regenerating the visual to stay in sync
7. Repeating the annotation cycle (typically 1–6 times)
8. Finalizing on user approval

**The PRD phase is complete when the user explicitly approves the PRD.**

Then tell the user:

> **Phase 2 complete.** The PRD is approved at `<file-path>` and the visual is at `<diagram-path>` (opened in your browser).
>
> Say **"break it into tasks"** when you're ready and I'll run `/tasks`.

**Wait for the user to trigger Phase 3.** This is a phase-boundary gate. Within Phase 2, the PRD draft, write, annotation-cycle edits, and visual-companion generation all proceed without per-call approval.

---

## Phase 3: Tasks (vertical-slice tracer bullets)

Once the user triggers it, invoke the `tasks` skill with the feature directory.

Use the Skill tool to invoke `tasks` with the feature directory path. If the user said "publish" or passed `--publish`, include that flag.

The `tasks` skill will handle:

1. Reading `prd.md`, `CONTEXT.md`, and relevant ADRs
2. Drafting a vertical-slice breakdown — each slice cuts through every layer end-to-end (HITL/AFK markers, dependency relationships)
3. Writing `tasks.md` and generating `tasks.html`
4. Quizzing the user on granularity, dependencies, HITL/AFK, coverage
5. Iterating until approved
6. **Optional**: publishing to GitHub Issues if `--publish` was set

**The tasks phase is complete when the user approves the breakdown.**

Then tell the user:

> **Phase 3 complete.** Tasks approved at `<file-path>`. <n> slices: <m> AFK, <k> HITL.
> *(if published: "Published as GitHub Issues #<first>–#<last>")*
>
> Say **"implement"** when you're ready.

**Wait for the user to trigger Phase 4.** This is a phase-boundary gate. Within Phase 3, the task-breakdown drafting, file writes, visual generation, and (optional) GitHub publishing proceed without per-call approval.

---

## Phase 4: Implementation (vertical-slice TDD)

Once the user triggers implementation, ask which mode:

> **Phase 4: Implementation**
>
> Choose your mode:
> - **`/implement`** — AI implements the code via vertical-slice TDD (one test → one impl → repeat)
> - **`/implement-coach`** — You implement the code; I write ONE test at a time and verify
>
> Say "implement" for AI mode, or "coach me" for coached mode.

If the user says "implement" or doesn't specify, invoke `implement` with the feature directory.
If the user says "coach me" or "guided", invoke `implement-coach` with the feature directory.

Both modes use the same TDD philosophy (Pocock's): **vertical, never horizontal. One test, one implementation, repeat.** No batched tests upfront.

### AI Mode (`implement`)

1. For each slice: write tracer-bullet test → minimal code → next acceptance criterion → repeat
2. Refactor between slices, never while RED
3. Mark slices complete in `tasks.md` as they finish
4. Final verification loop (type check, lint, test, build)
5. Database review (conditional), simplify, refactor-cleaner, code-reviewer, doc-updater
6. Fact-check `prd.md` and `tasks.md`, refresh visuals
7. Generate `diff-review.html` if `visual-explainer` is available

### Coach Mode (`implement-coach`)

1. For each slice: AI writes ONE failing test → user implements → AI verifies → next test
2. AI never writes implementation code during Steps 1–3; the user does
3. Refactor together when GREEN, never while RED
4. Final verification loop (same as AI mode)
5. Post-completion cleanup is AI-driven, with code-reviewer findings surfaced to the user to fix

After completion, both modes report:

> **Implementation complete.** All slices executed, tests passing, verifications clean.
> *(If `diff-review.html` was generated: "Fact-checked visual diff at `<diagram-path>` (opened in your browser).")*

---

## Session Management

This workflow is designed to run in a **single long session**. By the time implementation starts, you've built deep shared understanding through grilling and PRD refinement. All artifacts — markdown and visual HTML — survive context compaction and can be re-read at any point.

`CONTEXT.md` and `docs/adr/` outlive any single session — they're the durable spine that successive `/build` runs sharpen.

## Key Principles

1. **Grill before drafting.** Don't let the PRD invent terminology — pin it down in `CONTEXT.md` first.
2. **Never write code before the tasks are approved.** Phases 1–3 are deliberately gated.
3. **Markdown files are the deliverables**, not chat summaries.
4. **Visual HTML pages are companions** — spatial understanding that markdown can't.
5. **The user injects judgment through annotations and approval gates** — domain knowledge, business constraints, engineering trade-offs.
6. **Vertical slices, never horizontal.** Each slice cuts through every layer end-to-end and is demoable on its own.
7. **One test, one implementation, repeat.** No batched tests upfront — Pocock's TDD anti-pattern is rejected.
8. **`CONTEXT.md` vocabulary everywhere** — PRD, tasks, test names, code identifiers.

## Visual-Explainer Integration Notes

The `visual-explainer` skill is **optional**. All visual steps are skipped gracefully if it is not installed.

When available, it produces self-contained HTML files with:
- Mermaid diagrams for flowcharts, sequence diagrams, state machines
- CSS Grid layouts for architecture overviews
- Styled HTML tables for data comparisons
- Dark/light theme support
- Zoom controls on all diagrams

If `visual-explainer` is installed, these commands are also available standalone:

- `/generate-architecture-diagram`
- `/generate-web-diagram`
- `/generate-visual-plan`
- `/generate-slides`
- `/diff-review`
- `/plan-review`
- `/project-recap`
- `/fact-check`

When available, `visual-explainer` also activates **proactively**: when about to render a complex table (4+ rows or 3+ columns) in the terminal, it generates an HTML table instead and opens it in the browser.

## Cleanup

After the feature is complete, the user can decide whether to:

- Keep the feature directory in `docs/claude/` for future reference
- Delete it
- Add `docs/claude/` to `.gitignore` if desired
- Commit the directory alongside the feature for posterity

`CONTEXT.md` and `docs/adr/` should be committed — they're project-wide, durable artifacts.
