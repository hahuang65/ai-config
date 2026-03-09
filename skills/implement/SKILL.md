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

## Process

1. **Read the plan**: Read the plan document thoroughly. Understand every task, every code snippet, every constraint.

2. **Implement everything**: Execute all tasks in the todo list, in order. You MUST use the `test-driven-development` skill (invoke it via the Skill tool) to guide implementation. For each task:
   - Implement the changes exactly as specified in the plan, following the TDD skill's red-green-refactor cycle
   - Mark the task as completed in the plan document by changing `- [ ]` to `- [x]`
   - Run type checks / linters continuously to catch issues early
   - Do NOT stop to ask for confirmation between tasks
   - **TDD is non-negotiable**: Write tests before or alongside implementation code. If the plan's todo list is missing test tasks, write tests anyway — every behavioral change must have test coverage. The absence of test tasks in the plan does not excuse the absence of tests in the implementation.
   - **Test structure**: Maximize shared setup — use `before`/`let`/`subject`/`factory` blocks (or the codebase's equivalent) so common state is defined once. Write a test that validates the shared setup is correct. Each individual test should be minimal: load the shared setup, apply the bare minimum mutation for the scenario, and assert. No duplicated setup across tests.

3. **Track progress**: Update the plan document after completing each task or phase so progress is always visible. The plan document is the source of truth for what's done and what remains.

4. **Maintain code quality**:
   - Do not add unnecessary comments or documentation unless the plan says to
   - Follow existing code patterns and conventions in the codebase
   - Each change MUST have test coverage — this is a hard requirement, not a suggestion
   - Maintain strict typing - avoid `any` or `unknown` types
   - Keep code clean and consistent with surrounding code

5. **Verify (comprehensive)**: You MUST run a systematic verification loop after all tasks are done. This is not optional.
   1. **Type check**: Run the project's type checker (e.g., `npx tsc --noEmit`, `mypy`, `go vet`, `bundle exec srb tc`)
   2. **Lint**: Run the project's linter (e.g., `npx eslint .`, `ruff check .`, `rubocop`, `golangci-lint run`)
   3. **Test**: Run the full test suite and confirm all tests pass
   4. **Build**: Run the build command if one exists (e.g., `npm run build`, `go build ./...`)

   If any step fails, fix the issue before proceeding. Repeat the loop until all 4 pass cleanly.

6. **Security review**: You MUST scan the changed files for common security issues. This is not optional.
   - Hardcoded secrets (API keys, passwords, tokens, connection strings)
   - SQL injection (string concatenation in queries)
   - XSS vulnerabilities (unescaped user input in HTML/JSX)
   - Path traversal (user-controlled file paths)
   - Missing authentication/authorization checks on new endpoints
   - Sensitive data in logs

   If CRITICAL issues are found, fix them immediately. Report any findings to the user.

7. **Simplify**: You MUST invoke `/simplify` to review the changed code for reuse opportunities, quality issues, and efficiency improvements. Fix any issues found. Then re-run the test suite to confirm nothing broke.

8. **Code review**: You MUST review all changed files with a quality lens. This is not optional.
   - Functions over 50 lines → split
   - Files over 800 lines → extract modules
   - Deep nesting (>4 levels) → flatten with early returns
   - Missing error handling → add
   - Mutation patterns → refactor to immutable
   - Dead code or unused imports → remove

   Fix any HIGH issues found. Re-run tests after fixes.

9. **Fact-check the plan**: You MUST invoke `/fact-check` on the plan document. This is not optional. Use the Skill tool to invoke `fact-check` with the plan file path as the argument. This verifies that all claims (file paths, line numbers, function names, behavior descriptions) match what was actually implemented. Do NOT skip this step.

10. **When complete**: Tell the user implementation is complete and summarize what was done, including test coverage added. Do NOT commit to version control — leave that to the user.

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

## Visual Companion (when invoked from build-feature)

When this skill is invoked as part of the `build-feature` workflow, the orchestrator may generate a visual diff review (HTML page with executive summary, KPI dashboard, architecture comparison, code review analysis, and decision log) after all implementation tasks are complete — but only if the `visual-explainer` skill is available. If it is not available, the visual step is silently skipped. The implement skill itself does NOT generate the review — it focuses purely on executing the plan.
