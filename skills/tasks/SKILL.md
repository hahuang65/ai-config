---
name: tasks
description: Break a spec into independently-grabbable tasks using tracer-bullet vertical slices. Produces docs/features/<slug>/tasks.md and tasks.html locally. Use after a spec has been approved. Based on Matt Pocock's to-issues skill.
argument-hint: [specs-path-or-slug]
---

# Tasks Phase

Break an approved spec into independently-grabbable tasks using **vertical slices** (tracer bullets). Each task is a thin slice that cuts through ALL integration layers end-to-end — NOT a horizontal slice of one layer.

## Place in the /build Pipeline

This is **Phase 3** of the `/build` pipeline; it assumes Phase 2 (`/specs`) produced an approved `spec.md` / `spec.html`. See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for file conventions; write `tasks.md` and `tasks.html` into the feature directory. Read [../shared/references/testable-interfaces.md](../shared/references/testable-interfaces.md) before drafting slices so each slice carries the spec's public-interface test surface forward.

When invoked **standalone**, `$ARGUMENTS` may contain a spec path, a slug to resolve, or a GitHub issue reference (fetch its body via `gh issue view` and treat it as the source).


## Rules Adherence

Comply with the project rules in `rules/`. In Claude Code these are global instructions; in pi, read from `~/.pi/agent/rules/`; in oh-my-pi, load via `rule://<name>` when entering the rule's domain. Task titles and descriptions use the domain vocabulary from `CONTEXT.md` and respect ADRs in the area being touched.

## Process

### Step 1: Gather context

Read `spec.md` thoroughly (or the GitHub issue body if that was passed), `CONTEXT.md`, and relevant ADRs. If you haven't explored the relevant code areas yet, do so now — titles and descriptions should be grounded in real modules.

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

### Step 3: Write `tasks.md`

Use the structure in [references/task-template.md](references/task-template.md). Number slices in dependency order (blockers first).

### Step 4: Generate `tasks.html`

Invoke the `visual-explainer` skill to produce `tasks.html` in the feature directory, and **open it in the browser**. The HTML must use "Tasks" in its `<title>` and `<h1>`, and emphasize the **dependency graph** between slices, the HITL/AFK split, and which user stories each slice covers.

### Step 5: Review and finalize

Review the breakdown with the user using the protocol in [../shared/references/artifact-review.md](../shared/references/artifact-review.md). For tasks, present the slices as a compact numbered list and **ask directly** — the list is short enough that conversation beats inline notes, though the user may also drop `//` annotations in `tasks.md`. Ask about:

- Granularity — too coarse or too fine; any slice to merge or split
- Dependency relationships between slices
- HITL vs AFK markers
- Any spec user story left uncovered

**Do not regenerate `tasks.html` during the review** — work from `tasks.md`; the open visual can lag until the cycles are done.

On the user's confirmation, finalize:

1. If the markdown changed during the review, regenerate `tasks.html` once (reopen it).
2. Report the slice count and HITL/AFK split, then advance to implementation:

> **Tasks ready** — <n> slices (<a> AFK / <h> HITL). `/implement` (I write tests and code) or `/implement-coach` (you code, I write one test at a time) — which do you prefer?

## Important Guidelines

- **Vertical, never horizontal.** "Set up the database schema" is a horizontal layer, not a tracer bullet. Reject it.
- **Each slice is demoable on its own.** If finishing slice N leaves the system broken or invisible, the slice is wrong.
- **No file paths or code snippets in task bodies.** They go stale before the task is even picked up.
- **Use `CONTEXT.md` vocabulary** in titles and descriptions.
- **Many thin slices beat few thick ones.** If a slice looks fat, split it.

Ultrathink.
