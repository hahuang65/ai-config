---
description: Execute approved vertical-slice tasks from docs/features/<slug>/tasks.md via TDD, slice by slice
---
Load the implement skill, then execute the approved tasks: $ARGUMENTS

Follow the implement skill workflow. Read `tasks.md` and the linked `prd.md` thoroughly. Work one slice at a time in dependency order using vertical-slice TDD: confirm the public interface from the PRD Testing Decisions and slice Test surface, write one failing behavior test through that seam, write minimal code to pass, refactor when GREEN, mark the slice complete, then move to the next. Do not ask which modules need tests, do not batch tests across slices. Run type checks and linters continuously. Do not stop between slices to ask for confirmation.

If no argument is given, look in `docs/features/` for the most recent `*/tasks.md` and confirm with the user.
