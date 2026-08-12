---
name: build
description: Full feature development workflow — grill, conditional UI mockup, canonical HTML spec and tasks, vertical-slice TDD implementation, then intent-aware Review change as the final gate.
argument-hint: [feature-description]
disable-model-invocation: true
---

# Build Pipeline — Orchestrator

A disciplined 5-phase workflow for building features. Each phase is its own skill; run them in order, waiting for user approval between phases.

**Pipeline:** `/grill` → *conditional* `/mockup` → `/spec` → `/todo` → `/code` *(or `/coach`)* → `/review-change`

See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for the approval gates, timestamped Feature directory convention, session management, and canonical HTML synchronization rules every phase obeys. Read it first.

## Worktree Isolation Before Phase 1

Inspect Git worktree metadata before starting the pipeline.
If the current checkout is any existing linked worktree, continue there without Orchard adoption or relocation.
This includes linked worktrees that Orchard does not manage.
Do not require the executable merely to continue in an existing linked worktree.

Outside a linked worktree, run `command -v orchard` and verify `orchard status --json` reports the supported protocol.
When preflight succeeds, load [../orchard/SKILL.md](../orchard/SKILL.md) and delegate the branch-state choice, acquisition, and same-window transition to Orchard.
Build contains no native-transition implementation of its own.
Resume the phase that requested the transition without restarting the pipeline.

When preflight reports a missing or incompatible executable, warn that worktree isolation and Orchard delivery support will be unavailable.
Ask for explicit approval to continue on an ordinary local task branch through the established branch workflow.
This degraded mode is never automatic and is not Orchard-managed.
If the user declines, stop with guidance to run `~/.dotfiles/git/install.sh`.
Never offer the branch fallback after acquisition or native transition begins; preserve and report the task path instead.
The degraded-mode choice is an environment safety decision, not an additional pipeline approval gate.

## Mandatory Phase Loading

`/build` is an orchestrator, not a replacement for the phase skills. At the start of each phase, **read that phase's `SKILL.md` by relative path and follow it**:

- Phase 1: [../grill/SKILL.md](../grill/SKILL.md), which invokes [../model-domain/SKILL.md](../model-domain/SKILL.md) for active domain modeling
- Conditional design support after grilling: [../mockup/SKILL.md](../mockup/SKILL.md)
- Phase 2: [../spec/SKILL.md](../spec/SKILL.md)
- Phase 3: [../todo/SKILL.md](../todo/SKILL.md)
- Phase 4a: [../code/SKILL.md](../code/SKILL.md)
- Phase 4b: [../coach/SKILL.md](../coach/SKILL.md)
- Phase 5: [../review-change/SKILL.md](../review-change/SKILL.md)
- HTML feedback support for conditional mockup and Phases 2, 3, and 5: [../review-artifact/SKILL.md](../review-artifact/SKILL.md)

Do **not** decide whether a phase exists from the `available_skills` list or by interpreting names like "grill" as ordinary English. If this `/build` skill loaded, these phase files are part of the same installed skill bundle; load them directly by path. In harnesses without a skill-invocation tool, "invoke `<phase>`" means: read the phase `SKILL.md`, follow its linked references as needed, and execute its workflow.

Each phase also runs standalone:

- `/grill [topic]` — Phase 1: interview and invoke `model-domain` to refine the selected context documentation and write qualifying decision records
- `/model-domain [build|augment|audit] [scope-or-topic]` — standalone domain-modeling session without the full feature interview or pipeline
- `/mockup [topic]` — conditional design support: review material browser or terminal UI before specification
- `/spec [topic]` — Phase 2: synthesize canonical HTML from grilling and approved UI intent, then review it through `review-artifact`
- `/todo [spec-dir]` — Phase 3: vertical-slice tracer-bullet breakdown
- `/code [tasks-dir]` — Phase 4a: AI implements via TDD, slice by slice
- `/coach [tasks-dir]` — Phase 4b: user implements, AI writes one test at a time
- `/review-change [target]` — Phase 5: intent-aware review of the feature change, a local Git range, or a GitHub pull request
- `/review-code [area]` — optional standalone architectural exploration of the entire codebase or named area

## Approval Gate Scope (read first)

This skill has exactly **four** approval gates — Design→Spec, Spec→Tasks, Tasks→Implement, Review→done — the only phase-boundary confirmations. Relevant UI clears Design→Spec through explicit mockup approval; work without relevant UI clears it through post-grill chat confirmation. (Implementation flows into the Phase 5 review without a gate; the final gate is Review change's approve-as-is or fix-selected decision.) The one pre-pipeline degraded-mode consent described above is a safety choice, not an artifact-approval gate. Within an active phase, all routine operations (reads, writes, edits, bash, tests, environment bootstrap) proceed without per-call approval. Asking "OK to proceed?" before each tool batch is not how this skill works.

## Process

Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, max ~5 words). Run each phase skill in order. Create and pass the feature directory before a relevant mockup, or at the start of Phase 2 when no mockup is relevant.

### Phase 1: Design (Grill + conditional Mockup)

Load [../grill/SKILL.md](../grill/SKILL.md), then run `grill` with the feature description.
Grill invokes `model-domain` to resolve the worktree documentation destination and maintain the ubiquitous language and qualifying decision records.
It updates local `CONTEXT.md` / `docs/adr/` or an A5 linked worktree's saved Confluence pages project-wide and does NOT create the feature directory yet.

Determine mockup relevance from the grilled scope and inspected code, and ask the user only when that classification remains genuinely ambiguous.
When the scope establishes relevant UI, create the Feature directory, load [../mockup/SKILL.md](../mockup/SKILL.md), and run `mockup`.
It writes canonical `mockups.html`; explicit mockup approval clears the Design→Spec gate and starts Spec without another confirmation.

Post-grill chat confirmation clears that gate when there is no relevant UI.
In that branch, tell the user what was updated and:

> Ready to move on? Confirm and I'll synthesize what we discussed into the spec.

**Wait for the user to confirm before Phase 2 when no mockup is relevant.** This chat confirmation clears the same Design→Spec gate; within Phase 1 nothing else pauses.

### Phase 2: Spec + Review

Create the feature directory `docs/features/<YYYYMMDD-HHMM>-<slug>/` if the mockup path did not already create it, then load [../spec/SKILL.md](../spec/SKILL.md) and run `spec` with the feature description and that path.
When present, pass approved `mockups.html` as Authoritative intent.
Spec writes canonical `specs.html`, summarizes and links the selected design without duplicating it, and runs the [review artifact workflow](../shared/references/review-artifact.md) through `review-artifact`.
The user annotates rendered elements or text and sends messages; `spec` addresses every batch in the same HTML so the browser live-reloads the current artifact.

**Wait for an explicit browser approval or chat-fallback confirmation** — that approval *is* the Spec→Tasks gate.
No separate approval prompt follows; proceed straight to Phase 3.

### Phase 3: Tasks (vertical-slice tracer bullets)

Load [../todo/SKILL.md](../todo/SKILL.md), then run `todo` with the feature directory.
It reads `specs.html` and approved `mockups.html` when present, writes canonical `tasks.html` with vertical slices and HITL/AFK metadata, then runs the same live review artifact workflow.

**Wait for explicit browser approval or chat-fallback confirmation** — that approval *is* the Tasks→Implement gate.
Then proceed to Phase 4.

### Phase 4: Implementation (vertical-slice TDD)

Ask which mode:

> - **`/code`** — AI implements the code via vertical-slice TDD (one test → one impl → repeat)
> - **`/coach`** — You implement; I write ONE test at a time and verify

If the user says "implement" or doesn't specify, load [../code/SKILL.md](../code/SKILL.md) and run `code` with the feature directory. If they say "coach me" or "guided", load [../coach/SKILL.md](../coach/SKILL.md) and run `coach`. Both run the same TDD philosophy and full verification loop, then run only the `refactorer` hygiene sweep on changed files. After completion, report final status (slices, tests, every final verification command with its scope and outcome, and hygiene) and proceed straight to Phase 5 — no gate here.

### Phase 5: Review Change (the pipeline's final step)

Load [../review-change/SKILL.md](../review-change/SKILL.md), then run `review-change` in build mode against **ONLY the feature change** from the branch point through the current working state. Pass approved `mockups.html` when present with canonical `specs.html` and `tasks.html` as Authoritative intent, the implementation mode (`code` or `coach`) for repair ownership, and the exact final implementation verification commands, scopes, and outcomes as prior broad evidence that Review change records but does not rerun.

Review change runs the fixed validation kernel: fresh adversarial full-change review, targeted Validation evidence, documentation check, lint, canonical-artifact fact-checking, and final report generation. It may repair objective Findings according to its mode and always reruns from the earliest invalidated stage.

Open the self-contained Review change report through `review-artifact`; its explicit approval is the Review→done gate. The user may add or disposition Findings, attach instructions, fix selected Findings, or approve as-is. Every `ask-user` Finding needs an explicit disposition before approval.

Approval ends the pipeline. `/review-code` remains available afterward when the user explicitly wants optional architectural deepening.

## Key Principles

1. **Grill before drafting.** Use `model-domain` to establish the ubiquitous language in the selected context documentation and codify qualifying decision records.
2. **Mock up material UI before specification.** Use one recommended design by default and alternatives only for a real unresolved fork.
3. **Never write code before tasks are approved.** Phases 1–3 are gated.
4. **Canonical semantic HTML files are the feature deliverables.** Do not create Markdown companions.
5. **Vertical slices, never horizontal.** Each slice cuts through every layer.
6. **Test stable public interfaces.** Use [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md): Spec proposes module test surfaces, tasks carry them forward, implementation writes one behavior test at a time through the seam.
7. **One test, one implementation, repeat.** No batched tests upfront.
8. **Ubiquitous language everywhere** — use the canonical terms from the selected context documentation in the mockup, spec, tasks, test names, and code identifiers.

## Visual-Explainer Integration

The `visualize` skill is optional for informational visuals, but a relevant mockup and Phases 2 and 3 always produce their required canonical semantic HTML artifacts.
When available it provides presentation guidance and the standalone `/visualize-diff` command.
Review change fact-checks and updates the canonical `specs.html` and `tasks.html` directly rather than generating Markdown companions or an automatic diff review.
## Cleanup

After the feature is complete, the user decides whether to keep, delete, or commit the Feature directory, including `mockups.html` when present.
Defer inclusion of Feature artifacts and local context or decision files to the `git-commit` rule, including its A5 project exception.
Never stage worktree-private destination state or Confluence pages.
