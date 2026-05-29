---
name: prd
description: Synthesize a Product Requirements Document from the current conversation context (typically a /grill session) and the codebase. Produces docs/claude/<slug>/prd.md with user stories, decisions, and testing notes — no code snippets, no file paths. Supports annotation cycles. Based on Matt Pocock's to-prd skill.
argument-hint: [feature-description]
---

# PRD Phase

Take the current conversation context — including any prior `/grill` session that updated `CONTEXT.md` and `docs/adr/` — and synthesize a Product Requirements Document. **Do NOT interview the user further.** The grilling session was the design phase; this phase just transcribes its outcome into a durable artifact.

## Place in the /build Pipeline

This is **Phase 2** of the `/build` pipeline. The skill assumes `/grill` (Phase 1) has already happened — either in the current conversation or recorded in `CONTEXT.md`/`docs/adr/`.

If invoked **standalone**, the user is asking for a PRD from whatever context already exists. Don't re-interview; if the context feels thin, point them at `/grill` instead.

If invoked **from `/build`**, the orchestrator provides the feature directory path. Write `prd.md` and `prd.html` into that directory.

## File Naming Convention

```
docs/claude/<YYYYMMDD-HHMM>-<slug>/prd.md
docs/claude/<YYYYMMDD-HHMM>-<slug>/prd.html
```

To generate when running standalone:
1. Derive a short slug from `$ARGUMENTS` (lowercase, hyphens, no special chars, max ~5 words)
2. Get the current timestamp via `date +%Y%m%d-%H%M`
3. Create directory `docs/claude/<timestamp>-<slug>/` if it doesn't exist
4. Write `prd.md` inside that directory

## Rules Adherence

Comply with the project rules in `rules/` (coding-style, testing, security, performance, git-commit). In Claude Code these are auto-loaded as global instructions; in omp, load via `rule://<name>` when entering the rule's domain. Testing decisions must follow the testing rules. Implementation decisions must respect security and performance rules.

## Process

### Step 1: Read context

Before writing the PRD:

- Read `CONTEXT.md` at the repo root (and any subordinate `CONTEXT.md` files via `CONTEXT-MAP.md`). Use this vocabulary throughout the PRD.
- Read recent ADRs in `docs/adr/` — particularly any added during the current session — and respect them in the PRD.
- Skim the codebase area the feature touches. The PRD is grounded in the actual codebase, not assumptions.

### Step 2: Sketch the modules

Identify the major modules you would need to build or modify to deliver the feature. **Actively look for opportunities to extract deep modules** that can be tested in isolation.

> A deep module encapsulates a lot of functionality behind a simple, testable interface that rarely changes. Prefer deep modules over shallow ones — a shallow module is one where the interface is nearly as wide as the implementation, providing little encapsulation value.

This is the one micro-checkpoint in this phase. Briefly confirm with the user:

> Here are the modules I think this feature needs:
> - **<ModuleName>** — <one-line purpose>
> - **<ModuleName>** — <one-line purpose>
>
> Do these match your mental model? Which of these should have tests written for them?

Wait for the user's answer before continuing. Their answer informs the Testing Decisions section.

### Step 3: Write the PRD

Create `prd.md` using the template below.

```markdown
# {Feature Name} — PRD

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

Example: "As a mobile bank customer, I want to see the balance on my accounts, so that I can make better informed decisions about my spending."

This list should be extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified (from Step 2)
- The interfaces of those modules
- Technical clarifications agreed during grilling
- Architectural decisions (and pointers to relevant ADRs)
- Schema changes
- API contracts
- Specific interactions

**Do NOT include specific file paths or code snippets.** They go stale fast and the PRD outlives them.

*Exception:* if grilling produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly where it came from. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test in this codebase (test external behavior, not implementation details — see the testing rules)
- Which modules will be tested (from Step 2's confirmation)
- Prior art for the tests (i.e. similar types of tests already in the codebase)

## Out of Scope

A description of things that are deliberately out of scope for this PRD.

## Further Notes

Any further notes about the feature.
```

### Step 4: Generate Visual PRD

After writing the PRD markdown, invoke `/generate-visual-plan` to produce an HTML companion. The output MUST be written to `prd.html` in the same feature directory as `prd.md`. Do NOT write to `~/.agent/diagrams/` or any other location. Open it in the browser.

**Important:** The generated HTML must use "PRD" (not "Plan") in its `<title>` and `<h1>` header — e.g., `<title>PRD — Cursor Pagination</title>` and `<h1>Cursor Pagination — PRD</h1>`. The visual should emphasize user stories, decisions, and module sketches — not file maps or code snippets (the PRD has neither).

### Step 5: Stop and Wait for Annotation

After writing both the PRD and the visual, STOP. Tell the user the exact file paths, then:

> The PRD is ready for your review at `<file-path>`.
> I've also generated a visual companion at `<diagram-path>` (opened in your browser).
>
> To annotate, add `//` comments anywhere in the markdown file:
>
> ```markdown
> ## User Stories
>
> // also need: "as an admin, I want to revoke sessions"
> 1. As a customer, I want to see my balance...
>
> // remove this — it's out of scope per the grill session
> 7. As a customer, I want to export to CSV...
>
> // this should reference ADR-0003, not 0002
> ```
>
> Just type `//` followed by your note — corrections, additions, scope cuts, missing user stories, or clarifications. Then tell me to address your notes.

Do NOT proceed to `/tasks` or implementation.

### Step 6: Address Annotations

When the user says they've added notes:

1. Read the updated PRD
2. Find ALL `//` annotations the user added
3. Address every single note — do not skip any
4. Update the PRD accordingly
5. Remove the user's `//` annotations as you address them (so they don't accumulate)
6. **Regenerate `prd.html`** to stay in sync with the updated markdown. This is mandatory — even if the user says to move on to `/tasks`, the visual MUST be updated first.
7. STOP and tell the user the PRD is updated, ready for another review

**Do NOT proceed.** Repeat this cycle until the user explicitly approves the PRD.

**Non-negotiable:** The visual HTML file (`prd.html`) MUST always mirror the markdown (`prd.md`). Whenever the markdown changes — from annotations, corrections, or any other update — regenerate the HTML before proceeding to ANY next step.

### Step 7: Finalize on Approval

When the user approves the PRD:

1. **Final sync**: regenerate `prd.html` from the final `prd.md` and open in the browser.
2. Tell the user:

> **The PRD is approved.** I've updated the visual at `<diagram-path>` (opened in your browser).
>
> Say **"break it into tasks"** when you're ready and I'll run `/tasks` to generate vertical-slice tracer-bullet tasks.

**Still do NOT proceed to `/tasks`.** Wait for the user to trigger it.

## Important Guidelines

- **Synthesize, don't interview.** Grilling is over by the time you run. If essential information is genuinely missing, ask one targeted question — but do not re-run the grill session.
- **Use CONTEXT.md vocabulary throughout.** If the glossary says "Customer", do not write "User" or "Account".
- **No code snippets, no file paths in the PRD body** (except the narrow exception in Implementation Decisions). The PRD is a durable spec; code snippets and paths rot fast.
- **Reference ADRs by number.** When the PRD touches a recorded decision, link to it: "see ADR-0003 for the event-sourcing rationale".
- The annotation cycle typically repeats 1-6 times — this is normal.
- Every annotation from the user must be addressed; never ignore feedback.
- Keep the PRD focused — actively suggest cutting scope if it grows too large.

Ultrathink.
