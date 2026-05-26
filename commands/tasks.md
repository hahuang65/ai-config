---
description: Break an approved PRD into vertical-slice tracer bullets; --publish for GitHub Issues
---
Load the tasks skill, then break the PRD into tasks: $ARGUMENTS

Follow the tasks skill workflow. Read `prd.md`, `CONTEXT.md`, and relevant ADRs. Draft vertical-slice tracer bullets — each slice cuts through every layer end-to-end (schema, API, UI, tests) and is demoable on its own. NOT horizontal slices of one layer. Mark each slice HITL (human-in-the-loop) or AFK (away-from-keyboard); prefer AFK. Write `tasks.md` in dependency order (blockers first) and generate `tasks.html`. Quiz the user on granularity, dependencies, HITL/AFK split, and user-story coverage. Iterate until approved. If `--publish` is in `$ARGUMENTS` or the user says "publish them", create real GitHub Issues via `gh issue create` in dependency order, and back-fill issue numbers into `tasks.md`. Otherwise, stay local.

If no argument is given, look in `docs/claude/` for the most recent `*/prd.md` and confirm with the user.
