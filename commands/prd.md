---
description: Synthesize a PRD from the current conversation (typically a /grill session) — user stories, decisions, no code
---
Load the prd skill, then draft the PRD: $ARGUMENTS

Follow the prd skill workflow. Read `CONTEXT.md`, recent ADRs, and the prior conversation. Do NOT re-interview — grilling was the design phase; this transcribes its outcome. Sketch the major modules (deep-modules philosophy) and confirm them with the user. Write `prd.md` to `docs/claude/<YYYYMMDD-HHMM>-<slug>/prd.md` with sections: Problem Statement, Solution, User Stories (extensive numbered list), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes. Use `CONTEXT.md` vocabulary throughout. NO code snippets, NO file paths — they go stale. Generate `prd.html` via `/generate-visual-plan`. Then stop and wait for user annotations via `//` comments. Address every annotation, regenerate `prd.html` after each cycle, repeat until the user explicitly approves.

If no argument is given, infer the topic from the prior conversation context.
