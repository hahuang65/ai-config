---
description: Synthesize a spec from the current conversation (typically a /grill session) — user stories, decisions, no code
---
Load the specs skill, then draft the spec: $ARGUMENTS

Follow the specs skill workflow. Read `CONTEXT.md`, recent ADRs, and the prior conversation. Do NOT re-interview — grilling was the design phase; this transcribes its outcome. Sketch the major modules (deep-modules philosophy), propose the public-interface test surface for each yourself, and confirm only module boundaries/seams with the user. Do not ask which modules need tests. Write `specs.md` to `docs/features/<YYYYMMDD-HHMM>-<slug>/specs.md` with sections: Problem Statement, Solution, User Stories (extensive numbered list), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes. Use `CONTEXT.md` vocabulary throughout. NO code snippets, NO file paths — they go stale. Generate `specs.html` via the `visualize` skill and open it. Then review `specs.md` with the user (default to `//` annotations): if they give feedback, address every point and re-present — work from the markdown, don't regenerate the visual during the loop; if instead they confirm (any affirmative response), regenerate `specs.html` once if it changed and move on to `/todo`. No separate review-done sign-off.

If no argument is given, infer the topic from the prior conversation context.
