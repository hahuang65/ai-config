---
name: todo
description: Break an approved HTML-native spec into independently grabbable tracer-bullet slices, write canonical tasks.html with stable task metadata, and review it through review-artifact.
argument-hint: [specs-path-or-slug]
---

# Tasks Phase

Break an approved spec into independently-grabbable tasks using **vertical slices** (tracer bullets). Each task is a thin slice that cuts through ALL integration layers end-to-end — NOT a horizontal slice of one layer.

## Place in the /build Pipeline

This is **Phase 3** of the `/build` pipeline; it assumes Phase 2 produced an approved canonical `specs.html`.
See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions; write canonical `tasks.html` into the feature directory.
Read [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) before drafting slices so each slice carries the spec's public-interface test surface forward.

When invoked **standalone**, `$ARGUMENTS` may contain an HTML spec path, a slug to resolve, or a GitHub issue reference.
Fetch a referenced issue body via `gh issue view` and treat it as the source.


## Process

### Step 1: Gather context

Read canonical `specs.html` thoroughly (or the GitHub issue body if that was passed), the applicable context files, and relevant ADRs.
Read approved `mockups.html` when present as Authoritative intent, and carry its information hierarchy, interaction behavior, important states, responsive intent, and accessibility decisions into UI acceptance criteria and Test surfaces.
If you have not explored the relevant code areas yet, do so now; titles and descriptions should be grounded in real modules.

### Step 2: Draft vertical slices

Break the spec into **tracer-bullet** tasks. Each is a thin vertical slice through every layer end-to-end (schema → API → UI → tests), NOT a horizontal slice of one layer. Carry forward the spec's Testing Decisions: each slice names the public interface its first RED test should exercise, and tests remain inside the vertical slice instead of becoming separate "write specs" tasks. Mark each:

- **HITL** (human-in-the-loop) — needs human interaction such as an architectural decision or design review
- **AFK** (away-from-keyboard) — can be implemented and merged without human interaction

Prefer **AFK over HITL** where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Avoid file paths and code snippets in task bodies — they go stale fast
</vertical-slice-rules>

### Step 3: Write canonical `tasks.html`

Use the semantic structure in [references/task-template.md](references/task-template.md).
Number slices in dependency order and include stable visible metadata for identity, completion status, dependencies, HITL/AFK mode, user-story coverage, test surface, and acceptance criteria.
The HTML must use `<feature title> - Tasks` in its `<title>`, use "Tasks" in its `<h1>`, and emphasize the dependency graph, HITL/AFK split, and story coverage.
Do not create `tasks.md` or a hidden duplicate model.

### Step 4: Review and finalize

Load `review-artifact` and review `tasks.html` as an approval review through [the shared protocol](../shared/references/review-artifact.md).
Ask the user to check granularity, dependency relationships, HITL/AFK markers, and uncovered spec stories.
If Task feedback materially redesigns UI, use this return path:

1. Pause the current Tasks approval review.
2. Run the changed `mockups.html` through [mockup](../mockup/SKILL.md) and its `review-artifact` loop until explicit approval.
3. Then synchronize `specs.html` and `tasks.html` with the approved mockup, renew the invalidated Spec approval, and renew the invalidated Tasks approval.
4. Continue to implementation only after both approvals are explicitly renewed.

After each feedback batch, update the same HTML and resume polling with an agent reply.
On explicit browser approval or chat-fallback confirmation, report the slice count and HITL/AFK split, then advance to implementation:

> **Tasks ready** — <n> slices (<a> AFK / <h> HITL). `/code` (I write tests and code) or `/coach` (you code, I write one test at a time) — which do you prefer?

## Important Guidelines

- **Vertical, never horizontal.** "Set up the database schema" is a horizontal layer, not a tracer bullet. Reject it.
- **Each slice is demoable on its own.** If finishing slice N leaves the system broken or invisible, the slice is wrong.
- **No file paths or code snippets in task bodies.** They go stale before a slice is picked up.
- **The visible semantic HTML is canonical.** Later phases read it directly and update its status metadata.
- **Do not coin competing domain terms.** If the spec or issue needs a missing or conflicting domain concept to be resolved, invoke [model-domain](../model-domain/SKILL.md) before drafting slices.
- **Many thin slices beat few thick ones.** If a slice looks fat, split it.
