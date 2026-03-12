---
name: implement
description: Execute an approved plan document from .claude/docs/, implementing all tasks while tracking progress in the plan. Use after the plan has been reviewed, annotated, and approved by the user.
argument-hint: [plan-filename]
model: sonnet
---

# Implementation Phase

Execute an approved plan, implementing all tasks without stopping, while tracking progress in the plan document.

## Prerequisites

- An approved plan document must exist in a feature directory under `docs/claude/`. The user will either:
  - Provide the directory path as `$ARGUMENTS` (e.g., `/implement docs/claude/20260227-1430-cursor-pagination/`)
  - Provide just the slug or partial path and you resolve it
  - Or if no argument is given, look in `docs/claude/` for the most recent `*/plan.md` file and confirm with the user that it's the right one
- The user has explicitly approved the plan (do not assume approval)

## Rules Adherence

Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). The skill itself — not just the agents it invokes — must follow these rules when writing implementation code, fixing issues, or making any code changes.

## Process

1. **Read the plan**: Read the plan document thoroughly. Understand every task, every code snippet, every constraint.

2. **Implement everything**: Execute all tasks in the todo list, in order. You MUST use the `tdd-guide` agent (via the Agent tool) to guide implementation. **Batch tasks**: invoke the tdd-guide with 3-5 related tasks per invocation rather than one task at a time — this reduces agent overhead while maintaining TDD discipline. Group tasks by the file or module they affect. For each batch:
   - Implement the changes exactly as specified in the plan, following the tdd-guide's red-green-refactor cycle for each task in the batch
   - Mark each task as completed in the plan document by changing `- [ ]` to `- [x]`
   - Run type checks / linters continuously to catch issues early
   - Do NOT stop to ask for confirmation between tasks
   - If the plan's todo list is missing test tasks, write tests anyway — every behavioral change must have test coverage. The absence of test tasks in the plan does not excuse the absence of tests in the implementation.

3. **Track progress**: Update the plan document after completing each task or phase so progress is always visible. The plan document is the source of truth for what's done and what remains.

4. **Maintain code quality**: Follow existing code patterns and conventions in the codebase. Do not add unnecessary comments or documentation unless the plan says to. The `tdd-guide` and `code-reviewer` agents enforce the rules in `rules/` — write code that will pass their review.

5. **Verify (comprehensive)**: You MUST run a systematic verification loop after all tasks are done. This is not optional.
   1. **Type check**: Run the project's type checker (e.g., `npx tsc --noEmit`, `mypy`, `go vet`, `bundle exec srb tc`)
   2. **Lint**: Run the project's linter (e.g., `npx eslint .`, `ruff check .`, `rubocop`, `golangci-lint run`)
   3. **Test**: Run the full test suite and confirm all tests pass
   4. **Build**: Run the build command if one exists (e.g., `npm run build`, `go build ./...`)

   If any step fails, fix the issue before proceeding. Repeat the loop until all 4 pass cleanly.

6. **Database review** *(if the feature touches database code)*: If the implementation involved SQL queries, migrations, schema changes, or ORM operations, you MUST run the `database-reviewer` agent (via the Agent tool). Fix any CRITICAL or HIGH issues found.

7. **Simplify**: You MUST invoke `/simplify` to review the changed code for reuse opportunities, quality issues, and efficiency improvements. Fix any issues found. Then re-run the test suite to confirm nothing broke.

8. **Refactor cleanup**: You MUST run the `refactor-cleaner` agent (via the Agent tool) on the changed files. Remove SAFE items, verify CAREFUL items. Re-run tests after cleanup.

9. **Code review**: You MUST run the `code-reviewer` agent (via the Agent tool) on all changed files. This is not optional. The agent reads and enforces the project's `rules/` files, applies confidence-based filtering (>80% confidence threshold), and reports findings by severity — including OWASP Top 10 security checks. Fix any CRITICAL and HIGH issues found. Re-run tests after fixes.

10. **Documentation update** *(if the feature warrants it)*: If the implementation added new features, changed APIs, or modified architecture, run the `doc-updater` agent (via the Agent tool). Skip for trivial changes.

11. **Fact-check the plan**: You MUST invoke `/fact-check` on the plan document. This is not optional. Use the Skill tool to invoke `fact-check` with the plan file path as the argument. This verifies that all claims (file paths, line numbers, function names, behavior descriptions) match what was actually implemented. Do NOT skip this step.

12. **Refresh visual plan**: If `plan.html` exists in the feature directory, regenerate it by invoking `/generate-visual-plan` so the visual stays in sync with the final plan state. This is mandatory — the visual MUST always mirror the markdown. Do not skip this step regardless of whether changes were made to the plan.

13. **Generate diff review**: If the `visual-explainer` skill is available, generate a visual diff review. Follow the `/diff-review` workflow: compare the current working tree against the branch point (typically `main`) to produce an HTML page with executive summary, KPI dashboard, architecture comparison, before/after panels, code review analysis, and decision log. Write to `diff-review.html` in the feature directory and open in the browser. Then run `/fact-check` on the generated HTML to verify claims against actual code and git history. If `visual-explainer` is not available, skip this step silently.

14. **Verify plan-to-implementation sync**: Read the final `plan.md` and compare it against the actual implementation. Ensure:
    - All todo items are checked off (`- [x]`)
    - The plan's detailed changes section accurately reflects what was actually implemented (update if deviations occurred)
    - Any implementation decisions that diverged from the plan are documented in the plan
    - The visual `plan.html` reflects the final state

15. **When complete**: Tell the user implementation is complete and summarize what was done, including test coverage added. Do NOT commit to version control — leave that to the user.

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
- If the plan says to do something, do it. If it doesn't mention something, don't do it — with one exception: **tests are always required**, even if the plan omits them
- **NEVER commit to version control** — no `git add`, `git commit`, or `git push`. The user will commit when they are ready

## Visual Sync Guarantee

All visual HTML files in the feature directory MUST mirror their markdown counterparts at all times. The implement skill is responsible for:

- **`plan.html`**: Regenerated after implementation to reflect final plan state (checked-off tasks, deviations noted). This is mandatory regardless of whether changes were detected.
- **`diff-review.html`**: Generated after implementation if `visual-explainer` is available. Summarizes what changed with executive summary, KPI dashboard, architecture comparison, and code review analysis.

If `visual-explainer` is not available, visual steps are silently skipped — the workflow proceeds with just the markdown artifacts.
