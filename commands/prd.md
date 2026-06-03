---
description: Synthesize a PRD from the current conversation (typically a /grill session) — user stories, decisions, no code
---
Load the prd skill, then draft the PRD: $ARGUMENTS

Follow the prd skill workflow. Read `CONTEXT.md`, recent ADRs, and the prior conversation. Do NOT re-interview — grilling was the design phase; this transcribes its outcome. Sketch the major modules (deep-modules philosophy) and confirm them with the user. Write `prd.md` to `docs/features/<YYYYMMDD-HHMM>-<slug>/prd.md` with sections: Problem Statement, Solution, User Stories (extensive numbered list), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes. Use `CONTEXT.md` vocabulary throughout. NO code snippets, NO file paths — they go stale. Generate `prd.html` via the `visual-explainer` skill and open it. Then review `prd.md` with the user (default to `//` annotations): if they give feedback, address every point and re-present — work from the markdown, don't regenerate the visual during the loop; if instead they confirm (any affirmative response), regenerate `prd.html` once if it changed and move on to `/tasks`. No separate review-done sign-off.

If no argument is given, infer the topic from the prior conversation context.
