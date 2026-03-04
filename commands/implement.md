---
description: Execute an approved plan document from docs/claude/, implementing all tasks while tracking progress
---
Load the implement skill, then execute the approved plan: $ARGUMENTS

Follow the implement skill workflow. Read the plan document thoroughly, implement all tasks in order using test-driven development, mark each task as completed in the plan, and run type checks and linters continuously. Do not stop between tasks to ask for confirmation.

If no argument is given, look in `docs/claude/` for the most recent `*/plan.md` and confirm with the user.
