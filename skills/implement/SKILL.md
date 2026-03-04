---
name: implement
description: Execute an approved plan document from .claude/docs/, implementing all tasks while tracking progress in the plan. Use after the plan has been reviewed, annotated, and approved by the user.
argument-hint: [plan-filename]
---

# Implementation Phase

Execute an approved plan, implementing all tasks without stopping, while tracking progress in the plan document.

## Prerequisites

- An approved plan document must exist in a feature directory under `docs/claude/`. The user will either:
  - Provide the directory path as `$ARGUMENTS` (e.g., `/implement docs/claude/20260227-1430-cursor-pagination/`)
  - Provide just the slug or partial path and you resolve it
  - Or if no argument is given, look in `docs/claude/` for the most recent `*/plan.md` file and confirm with the user that it's the right one
- The user has explicitly approved the plan (do not assume approval)

## Process

1. **Read the plan**: Read the plan document thoroughly. Understand every task, every code snippet, every constraint.

2. **Implement everything**: Execute all tasks in the todo list, in order. For each task:
   - Implement the changes exactly as specified in the plan, using test driven development
   - Mark the task as completed in the plan document by changing `- [ ]` to `- [x]`
   - Run type checks / linters continuously to catch issues early
   - Do NOT stop to ask for confirmation between tasks

3. **Track progress**: Update the plan document after completing each task or phase so progress is always visible. The plan document is the source of truth for what's done and what remains.

4. **Maintain code quality**:
   - Do not add unnecessary comments or documentation unless the plan says to
   - Follow existing code patterns and conventions in the codebase
   - Each change should have significant test coverage
   - Maintain strict typing - avoid `any` or `unknown` types
   - Keep code clean and consistent with surrounding code

5. **When complete**: After all tasks are done, tell the user implementation is complete and summarize what was done.

## Handling Issues During Implementation

- **Minor issues**: Fix them and continue. Note the deviation in the plan.
- **Significant deviations**: If something in the plan can't be implemented as written, STOP and tell the user what the issue is. Wait for guidance before continuing.
- **Test failures**: Fix them if the cause is clear. If not, stop and report.

## Feedback Loop

After implementation, the user may test and provide terse corrections:

- These will be short and direct: "wider", "still cropped", "move this to the admin app"
- Act on them immediately without asking for clarification
- You have full context from the plan and session - brief corrections are sufficient

When something goes in a wrong direction and the user reverts changes:

- Do not try to patch a bad approach
- Start fresh with the narrowed scope the user provides
- A clean restart almost always produces better results than incremental fixes

## Referencing Existing Code

When the user references existing code ("make it look like the users table", "same pattern as the auth middleware"), read that reference code first and match it precisely. Most features in a mature codebase are variations on existing patterns.

## Important Guidelines

- Implementation should be "boring" - all creative decisions were made during planning
- Do not stop between tasks to ask for permission to continue
- Do not add features or improvements not in the plan
- Do not refactor code that isn't part of the plan
- The plan is the spec - follow it faithfully
- If the plan says to do something, do it. If it doesn't mention something, don't do it.

## Visual Companion (when invoked from build-feature)

When this skill is invoked as part of the `build-feature` workflow, the orchestrator may generate a visual diff review (HTML page with executive summary, KPI dashboard, architecture comparison, code review analysis, and decision log) after all implementation tasks are complete — but only if the `visual-explainer` skill is available. If it is not available, the visual step is silently skipped. The implement skill itself does NOT generate the review — it focuses purely on executing the plan.
