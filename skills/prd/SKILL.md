---
name: prd
description: Synthesize a Product Requirements Document from the current conversation context (typically a /grill session) and the codebase. Produces docs/features/<slug>/prd.md with user stories, decisions, and testing notes — no code snippets, no file paths. Supports annotation cycles. Based on Matt Pocock's to-prd skill.
argument-hint: [feature-description]
---

# PRD Phase

Synthesize a Product Requirements Document from the grill session and codebase. **Do NOT interview the user further** — grilling was the design phase; this phase transcribes its outcome into a durable artifact.

## Place in the /build Pipeline

This is **Phase 2** of the `/build` pipeline. It assumes `/grill` (Phase 1) already happened — either in this conversation or recorded in `CONTEXT.md` / `docs/adr/`. If invoked standalone and the context feels thin, point the user at `/grill` instead. See [../shared/references/build-pipeline.md](../shared/references/build-pipeline.md) for the file conventions; write `prd.md` and `prd.html` into the feature directory (`docs/features/<YYYYMMDD-HHMM>-<slug>/`, created standalone if needed).

## Rules Adherence

Comply with the project rules in `rules/` (coding-style, testing, security, performance, git-commit). In Claude Code these are global instructions; in oh-my-pi, load via `rule://<name>` when entering the rule's domain. Testing Decisions must follow the testing rules; Implementation Decisions must respect security and performance rules.

## Process

### Step 1: Read context

- Read `CONTEXT.md` at the repo root (and subordinate `CONTEXT.md` files via `CONTEXT-MAP.md`). Use this vocabulary throughout.
- Read recent ADRs in `docs/adr/` — especially any added this session — and respect them.
- Skim the codebase area the feature touches. The PRD is grounded in the actual codebase, not assumptions.

### Step 2: Sketch the modules

Identify the major modules to build or modify. **Actively look for deep modules** — a lot of functionality behind a simple, testable interface that rarely changes. Prefer deep over shallow (a shallow module's interface is nearly as wide as its implementation).

This is the one micro-checkpoint in this phase. Briefly confirm with the user:

> Here are the modules I think this feature needs:
> - **<ModuleName>** — <one-line purpose>
>
> Do these match your mental model? Which should have tests written for them?

Wait for the answer before continuing — it informs the Testing Decisions section.

### Step 3: Write the PRD

Synthesize `prd.md` using the structure in [references/prd-template.md](references/prd-template.md). Use `CONTEXT.md` vocabulary; reference ADRs by number.

### Step 4: Generate the visual PRD

Invoke the `visual-explainer` skill to produce `prd.html` in the feature directory (not `~/.agent/diagrams/`), and **open it in the browser**. The HTML must use "PRD" (not "Plan") in its `<title>` and `<h1>` (e.g. `<h1>Cursor Pagination — PRD</h1>`) and emphasize user stories, decisions, and module sketches — not file maps or code.

### Step 5: Review and advance

Review `prd.md` with the user using the protocol in [../shared/references/artifact-review.md](../shared/references/artifact-review.md). For a PRD, default to **`//` annotations** — there's usually a lot to mark up inline. Point the user at what to check: missing or mis-stated user stories, implementation and testing decisions, and scope to cut. **Do not regenerate `prd.html` during the review** — work from `prd.md`; the open visual can lag until the cycles are done.

On the user's confirmation, regenerate `prd.html` once if the markdown changed (reopen it), then advance to the task breakdown:

> **PRD ready** — visual at `<diagram-path>` (opened in your browser). Breaking it into tasks via `/tasks`.

Then proceed to `/tasks`.

## Important Guidelines

- **Synthesize, don't interview.** If essential information is genuinely missing, ask one targeted question — don't re-run the grill.
- **Use `CONTEXT.md` vocabulary.** If the glossary says "Customer", don't write "User" or "Account".
- **No code snippets, no file paths** in the body (except the narrow exception in the template).
- **Generate `prd.html` when `prd.md` is first written and open it** — don't regenerate during the review; regenerate once at the end only if the markdown changed (and later on implementation drift).
- Keep the PRD focused — suggest cutting scope if it grows too large.

Ultrathink.
