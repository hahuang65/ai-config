---
description: Break an approved spec into vertical-slice tracer bullets, reviewed and refined locally
---
Load the tasks skill, then break the spec into tasks: $ARGUMENTS

Follow the tasks skill workflow. Read `spec.md`, `CONTEXT.md`, and relevant ADRs. Draft vertical-slice tracer bullets — each slice cuts through every layer end-to-end (schema, API, UI, tests), carries the spec's public-interface Test surface, and is demoable on its own. NOT horizontal slices of one layer. Mark each slice HITL (human-in-the-loop) or AFK (away-from-keyboard); prefer AFK. Write `tasks.md` in dependency order (blockers first), generate `tasks.html` via the `visual-explainer` skill, and open it. Review with the user — ask about granularity, dependencies, HITL/AFK split, and user-story coverage (they answer directly, or drop `//` annotations in `tasks.md`): if they give feedback, address it and re-present — work from the markdown, don't regenerate the visual during the loop; if instead they confirm, regenerate `tasks.html` once if it changed and move on to implementation. No separate review-done sign-off.

If no argument is given, look in `docs/features/` for the most recent `*/spec.md` and confirm with the user.
