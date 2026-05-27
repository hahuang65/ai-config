---
name: tasks
description: Break a PRD into independently-grabbable tasks using tracer-bullet vertical slices. Produces docs/claude/<slug>/tasks.md and tasks.html locally; pass --publish to also publish to GitHub Issues. Use after a PRD has been approved. Based on Matt Pocock's to-issues skill.
argument-hint: [prd-path-or-slug] [--publish]
---

# Tasks Phase

Break an approved PRD into independently-grabbable tasks using **vertical slices** (tracer bullets). Each task is a thin slice that cuts through ALL integration layers end-to-end — NOT a horizontal slice of one layer.

## Place in the /build Pipeline

This is **Phase 3** of the `/build` pipeline. It assumes Phase 2 (`/prd`) has produced an approved `prd.md` and `prd.html` in `docs/claude/<slug>/`.

When invoked **standalone**, `$ARGUMENTS` may contain:
- A PRD path (e.g. `docs/claude/20260227-1430-cursor-pagination/`) — read that PRD
- A slug — resolve it to a feature directory
- A GitHub issue reference (number, URL) — fetch the issue and treat its body as the source
- `--publish` flag — after local approval, also publish each task as a real GitHub Issue

When invoked **from `/build`**, the orchestrator provides the feature directory. Write `tasks.md` and `tasks.html` into that directory.

## File Naming Convention

```
docs/claude/<YYYYMMDD-HHMM>-<slug>/tasks.md     ← local, always written
docs/claude/<YYYYMMDD-HHMM>-<slug>/tasks.html   ← local, always written
```

Real GitHub Issues are only created if `--publish` is in `$ARGUMENTS` or the user explicitly says "publish them".

## Rules Adherence

Comply with the project rules already loaded in context. Task titles and descriptions must use the project's domain vocabulary from `CONTEXT.md` and respect ADRs in the area being touched.

## Process

### Step 1: Gather context

- Read the PRD (`prd.md`) thoroughly. If the user passed a GitHub issue reference instead, fetch its full body and comments via `gh issue view`.
- Read `CONTEXT.md` and any relevant ADRs in `docs/adr/`.
- If you haven't already explored the relevant code areas during the conversation, do so now — task titles and descriptions should be grounded in real modules.

### Step 2: Draft vertical slices

Break the PRD into **tracer-bullet** tasks. Each task is a thin vertical slice that cuts through every layer end-to-end (schema, API, UI, tests), NOT a horizontal slice of one layer.

Slices may be marked:
- **HITL** (human-in-the-loop) — requires human interaction such as an architectural decision or design review
- **AFK** (away-from-keyboard) — can be implemented and merged without human interaction

Prefer **AFK over HITL** where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Avoid file-paths and code snippets in task bodies — they go stale fast
</vertical-slice-rules>

### Step 3: Write `tasks.md`

Create the file using the template below. Number slices in dependency order (blockers first).

```markdown
# {Feature Name} — Tasks

Source PRD: [prd.md](./prd.md)

## Slice 1: {Short descriptive title}

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 2, 3 (from the PRD)

### What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Slice 2: {Short descriptive title}

**Type:** HITL — needs design review before implementation
**Blocked by:** Slice 1
**User stories covered:** 4, 5

### What to build

...

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

---
```

Avoid specific file paths or code snippets in the slice body. *Exception:* if the PRD's Implementation Decisions section already inlined a critical snippet (state machine, reducer, schema, type shape) tied to this slice, you may inline it here too. Trim to the decision-rich parts.

### Step 4: Generate `tasks.html`

After writing `tasks.md`, invoke `/generate-visual-plan` to produce an HTML companion. The output MUST be written to `tasks.html` in the same feature directory. Open it in the browser.

**Important:** The generated HTML must use "Tasks" in its `<title>` and `<h1>` — e.g. `<title>Tasks — Cursor Pagination</title>`. The visual should emphasize:
- The **dependency graph** between slices (which blocks which)
- The HITL/AFK split
- Which user stories each slice covers

### Step 5: Quiz the user

Present the proposed breakdown to the user as a compact numbered list (in chat — the markdown and visual are already on disk):

```
Proposed task breakdown:

1. <Title> — AFK, blocked by none, covers stories 1-3
2. <Title> — HITL, blocked by 1, covers stories 4-5
3. <Title> — AFK, blocked by 1, covers stories 6-8
...
```

Then ask:

> - Does the granularity feel right? (too coarse / too fine)
> - Are the dependency relationships correct?
> - Should any slices be merged or split further?
> - Are the correct slices marked as HITL and AFK?
> - Any user stories from the PRD that aren't covered by these slices?
>
> When the breakdown is right, say **"approve"** — I'll finalize `tasks.md` and `tasks.html`.

Iterate until the user approves. Each iteration: update `tasks.md`, regenerate `tasks.html`, re-present the numbered list.

**Non-negotiable:** `tasks.html` MUST mirror `tasks.md`. Regenerate the HTML on every change before proceeding.

### Step 6: Finalize on approval

When the user approves the breakdown:

1. Final sync of `tasks.md` and `tasks.html`.
2. **If `--publish` was in `$ARGUMENTS` or the user says "publish them":**
   - Publish each slice to GitHub Issues using `gh issue create`, in dependency order (blockers first) so you can reference real issue numbers in the "Blocked by" field of dependent slices.
   - Use the same body template as `tasks.md` per slice.
   - Update `tasks.md` to record the created issue numbers next to each slice (e.g. `## Slice 1: Foo (#123)`).
   - Regenerate `tasks.html` to reflect the issue numbers.
   - Do NOT close or modify any parent issue.
3. Tell the user:

> **Tasks approved.** Files updated:
> - `tasks.md` — <n> slices, <m> AFK / <k> HITL
> - `tasks.html` — refreshed in your browser
> *(if published: "Published <n> GitHub Issues: #<first>–#<last>")*
>
> Say **"implement"** when you're ready and I'll work through the slices via `/implement` (agent) or `/implement-coach` (you code, I write tests).

## Important Guidelines

- **Vertical, never horizontal.** A slice that says "set up the database schema" is a horizontal layer, not a tracer bullet. Reject it.
- **Each slice is demoable on its own.** If finishing slice N leaves the system in a broken or invisible state, the slice is wrong.
- **No file paths or code snippets in task bodies.** They go stale before the task is even picked up.
- **Use CONTEXT.md vocabulary in titles and descriptions.** Consistency with the glossary matters more than your favorite wording.
- **Many thin slices beat few thick ones.** If a slice looks fat, split it.
- **Local-by-default.** Never publish to GitHub Issues unless `--publish` is set or the user explicitly says to.

Ultrathink.
