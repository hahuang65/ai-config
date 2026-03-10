---
name: refactor
description: Perform user-directed code refactoring with incremental test verification. Use when restructuring code while preserving behavior — extract methods, split files, rename across codebase, simplify conditionals, decouple modules.
argument-hint: [refactoring-goal]
model: sonnet
---

# Refactoring

Perform a user-directed code refactoring that preserves behavior while improving structure. The workflow: analyze the target code, present a transformation plan, get user approval, then execute incrementally with test verification at each step.

## Process

### Step 1: Parse Goal

Read `$ARGUMENTS` to understand what the user wants refactored. Identify:

- The specific refactoring operation (extract, inline, move, rename, restructure, pattern change, decouple)
- The target files, functions, classes, or modules
- Any constraints the user mentioned

If the goal is vague (e.g., "clean up the auth module"), ask the user to clarify what specific structural change they want. Do not guess.

### Step 2: Read Target Code

Read the files and modules the user referenced. If the user named a directory or module rather than specific files, use Glob and Grep to identify all relevant files.

Understand:

- The current structure and dependencies
- How the target code is used by other parts of the codebase (callers, importers)
- The existing test coverage for the target code
- Any patterns or conventions the codebase follows

### Step 3: Detect Project Tooling

Identify the project's language and tooling by checking for config files:

| Config File | Language | Test Runner | Linter | Type Checker |
|------------|----------|-------------|--------|-------------|
| `package.json` | JS/TS | `npm test` / `npx jest` / `npx vitest` | `npx eslint .` | `npx tsc --noEmit` |
| `pyproject.toml` / `setup.py` | Python | `pytest` | `ruff check .` | `mypy .` |
| `Cargo.toml` | Rust | `cargo test` | `cargo clippy` | (built-in) |
| `go.mod` | Go | `go test ./...` | `golangci-lint run` | `go vet ./...` |
| `Gemfile` | Ruby | `bundle exec rspec` | `rubocop` | `bundle exec srb tc` |
| `Makefile` | (varies) | Check for `test` target | Check for `lint` target | Check for `typecheck` target |

Use the detected tooling for test runs and verification throughout the workflow.

### Step 4: Present Transformation Plan

Based on the analysis, create a numbered list of specific transformations. For each transformation, show:

1. **What**: The specific change (e.g., "Extract `validateInput()` from `processRequest()` in `handler.ts`")
2. **Files affected**: Which files will be modified
3. **Risk level**: SAFE, CAREFUL, or RISKY
4. **Why**: How this serves the user's refactoring goal

Example format:

```
Transformation Plan:

1. [SAFE] Extract `validateInput()` from `processRequest()` in `src/handler.ts`
   Files: src/handler.ts
   Why: Reduces function from 68 lines to ~30 lines

2. [CAREFUL] Move `ValidationError` class to new file `src/errors.ts`
   Files: src/handler.ts, src/errors.ts (new), src/middleware.ts (import update)
   Why: Single responsibility — error types get their own module

3. [CAREFUL] Update all imports of `ValidationError` to point to `src/errors.ts`
   Files: src/middleware.ts, src/routes/auth.ts, tests/handler.test.ts (NEEDS APPROVAL)
   Why: References must follow the moved class
```

**Scope warning**: If the plan would touch more than 15 files, warn the user and suggest breaking the refactoring into phases.

### Step 5: Wait for Confirmation

STOP and present the transformation plan to the user. Ask them to:

- **Confirm** to proceed as planned
- **Adjust** specific transformations (add, remove, reorder)
- **Cancel** if the scope is wrong

Do NOT proceed without explicit user approval.

### Step 6: Execute via Agent

Invoke the `refactorer` agent (via the Agent tool) with:

- The confirmed transformation plan (numbered list)
- The detected project tooling (test command, linter, type checker)
- Any user adjustments from Step 5

The agent will execute each transformation incrementally, running tests between each step and reverting on failure.

### Step 7: Final Verification

After the agent completes, run the full verification loop:

1. **Type check**: Run the project's type checker
2. **Lint**: Run the project's linter
3. **Test**: Run the full test suite
4. **Build**: Run the build command if one exists

If any step fails, fix the issue and repeat the loop until all 4 pass cleanly.

### Step 8: Report

Summarize the refactoring results:

- Transformations completed (and any that were skipped/reverted)
- Files modified
- Tests status (all passing)
- Any issues encountered

Do NOT commit to version control — leave that to the user.

## Scope Control Rules

- **Maximum scope**: Warn if a refactoring would touch more than 15 files. Suggest breaking into phases.
- **Vague goals**: Ask for clarification rather than guessing. "Clean up" is not a refactoring goal.
- **No feature creep**: Never add features during a refactor. Never change public API signatures unless the user explicitly asked.
- **Behavior preservation**: The refactored code must do exactly what the original code did.

## Handling Issues

- **Test failures during execution**: The agent reverts the failing transformation and reports. You decide whether to continue with remaining transformations or stop.
- **Existing tests need changes**: The agent stops and presents the required test changes. You present them to the user for approval.
- **Scope grows unexpectedly**: If a transformation reveals more work than anticipated, stop and update the plan with the user before continuing.
- **Ambiguous references**: If grep shows dynamic references (string interpolation, reflection, eval), flag them and let the user decide.

## Feedback Loop

After the refactoring completes, the user may provide terse corrections:

- "That function should stay in the original file"
- "Also rename the test helper"
- "Revert the move, just do the extract"

Act on corrections immediately. You have full context from the plan and execution — brief instructions are sufficient.

## Important Guidelines

- This skill produces transformed code, not documents. No `docs/claude/` artifacts.
- Refactoring is structure change, not behavior change. If you can't preserve behavior, stop.
- The transformation plan is the contract. Don't add transformations the user didn't approve.
- **NEVER commit to version control** — no `git add`, `git commit`, or `git push`.
