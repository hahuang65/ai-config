---
name: implement-coach
description: Coach the user through implementing code according to an approved plan, writing tests ahead of time and walking through each class/function. The user implements the code while the AI provides guidance, API specifications, and test verification. Use after the plan has been reviewed, annotated, and approved by the user.
argument-hint: [plan-filename]
model: sonnet
---

# Implementation Coaching Phase

Coach the user through implementing an approved plan, writing tests first and walking through each class/function step-by-step. The user writes the code; you provide guidance, API specifications, and test verification.

## Prerequisites

- An approved plan document must exist in a feature directory under `docs/claude/`. The user will either:
  - Provide the directory path as `$ARGUMENTS` (e.g., `/implement-coach docs/claude/20260227-1430-cursor-pagination/`)
  - Provide just the slug or partial path and you resolve it
  - Or if no argument is given, look in `docs/claude/` for the most recent `*/plan.md` file and confirm with the user that it's the right one
- The user has explicitly approved the plan (do not assume approval)
- The plan's "Todo List" section (not "Proposed Todo List") must be present, indicating approval

## Rules Adherence

Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). Guide the user to follow these rules when they implement code.

## Process

### Step 1: Read and Analyze the Plan

1. Read the approved plan document thoroughly
2. Understand every task, every code snippet, every constraint
3. Identify all modules, classes, functions, and methods that need to be created or modified
4. Group related tasks by file/module for efficient guidance

### Step 2: Write All Tests First

Before guiding the user through implementation, write ALL the tests upfront:

1. For each task in the Todo List that requires code changes, identify the corresponding test cases from the Testing Strategy section
2. Create test files for all new modules/classes
3. Write comprehensive tests that cover:
   - Happy path scenarios
   - Edge cases
   - Error conditions
4. Make sure tests are written but will fail (since implementation doesn't exist yet)
5. Run the test suite to confirm tests fail (red phase of TDD)

Tell the user:
> I've written all the tests upfront based on the plan's Testing Strategy.
> You can find them at:
> - `<test-file-1>`
> - `<test-file-2>`
> ...
>
> Currently, these tests are failing (as expected) since the implementation doesn't exist yet.
> We'll now walk through each module together.

### Step 3: Coach Through Each Module/Class

For each module, class, or significant unit of code identified in the plan:

1. **Present the module/class to implement:**
   ```
   ## Module: `<file-path>`

   ### Class/Function: `<name>`

   **Purpose:** <brief description from plan>

   **Expected API:**
   <show the interface/signature based on plan's Detailed Changes>

   **Tests to satisfy:**
   - `<test-name-1>`: <what it tests>
   - `<test-name-2>`: <what it tests>
   ...

   Here are the specific tests your implementation needs to pass:
   <show relevant test code snippets>
   ```

2. **Wait for user to implement:**
   - Tell the user: "Please implement this class/function. Once done, tell me to 'check' or 'verify'."
   - Do NOT write the implementation code yourself
   - Do NOT proceed until the user says they're ready

3. **Verify the implementation:**
   When the user says to check/verify:
   - Run the specific tests for the module just implemented
   - If tests pass: congratulate and move to next module
   - If tests fail:
     - Show the user the test failure output
     - Guide them on what needs to be fixed
     - Wait for them to fix and ask to check again

4. **Repeat** for each module/class in the plan

### Step 4: Mid-Implementation Review (Optional)

After completing ~50% of the modules, offer a quick review:
> We've completed half the implementation. Would you like me to:
> - Run the full test suite to see overall progress?
> - Review the code so far for any obvious issues?
> - Continue to the next module?

### Step 5: Final Verification

After all modules are implemented, run a systematic verification loop. This is not optional.

1. **Type check:** Run the project's type checker (e.g., `npx tsc --noEmit`, `mypy`, `go vet`, `bundle exec srb tc`)
2. **Lint:** Run the project's linter (e.g., `npx eslint .`, `ruff check .`, `rubocop`, `golangci-lint run`)
3. **Test:** Run the full test suite and confirm all tests pass
4. **Build:** Run the build command if one exists (e.g., `npm run build`, `go build ./...`)

If any step fails, guide the user through fixing the issue. Repeat the loop until all 4 pass cleanly.

### Step 6: Database Review *(if the feature touches database code)*

If the implementation involved SQL queries, migrations, schema changes, or ORM operations, you MUST run the `database-reviewer` agent (via the Agent tool) on the changed files. Present findings to the user. For CRITICAL or HIGH issues, guide the user to fix them — they wrote the code, they fix the issues. Re-run tests after each fix.

### Step 7: Simplify

You MUST invoke `/simplify` to review the changed code for reuse opportunities, quality issues, and efficiency improvements. For mechanical improvements (e.g., consolidating duplicate logic into an existing helper), apply them directly. For changes that involve behavioral judgment, present them to the user and let them decide. Re-run the test suite after any changes.

### Step 8: Refactor Cleanup

You MUST run the `refactor-cleaner` agent (via the Agent tool) on the changed files. Apply SAFE items directly (dead code removal, unused imports). For CAREFUL items, surface them to the user for verification. Re-run tests after cleanup.

### Step 9: Code Review

You MUST run the `code-reviewer` agent (via the Agent tool) on all changed files. This is not optional. The agent reads and enforces the project's `rules/` files, applies confidence-based filtering (>80% confidence threshold), and reports findings by severity — including OWASP Top 10 security checks. Present the findings to the user grouped by severity. For CRITICAL and HIGH issues, guide the user to fix them — coaching philosophy: the user writes the code. Re-run tests after each fix.

### Step 10: Documentation Update *(if the feature warrants it)*

If the implementation added new features, changed APIs, or modified architecture, run the `doc-updater` agent (via the Agent tool). The AI handles documentation directly — this is not implementation code. Skip for trivial changes.

### Step 11: Fact-Check the Plan

You MUST invoke `/fact-check` on the plan document. This is not optional. Use the Skill tool to invoke `fact-check` with the plan file path as the argument. This verifies that all claims (file paths, line numbers, function names, behavior descriptions) match what was actually implemented. Do NOT skip this step.

### Step 12: Refresh Visual Plan

If `plan.html` exists in the feature directory, regenerate it by invoking `/generate-visual-plan` so the visual stays in sync with the final plan state. This is mandatory — the visual MUST always mirror the markdown. Do not skip this step regardless of whether changes were made to the plan.

### Step 13: Generate Diff Review

If the `visual-explainer` skill is available, generate a visual diff review. Follow the `/diff-review` workflow: compare the current working tree against the branch point (typically `main`) to produce an HTML page with executive summary, KPI dashboard, architecture comparison, before/after panels, code review analysis, and decision log. Write to `diff-review.html` in the feature directory and open in the browser. Then run `/fact-check` on the generated HTML to verify claims against actual code and git history. If `visual-explainer` is not available, skip this step silently.

### Step 14: Verify Plan-to-Implementation Sync

Read the final `plan.md` and compare it against the actual implementation. Ensure:
- All todo items are checked off (`- [x]`)
- The plan's detailed changes section accurately reflects what was actually implemented (update if deviations occurred)
- Any implementation decisions that diverged from the plan are documented in the plan
- The visual `plan.html` reflects the final state

### Step 15: Completion

When everything is done:
> **Implementation complete!** 🎉
>
> You've implemented all modules according to the plan. Here's what was accomplished:
> - Modules implemented: <list>
> - Tests written: <count>
> - All tests passing: ✅
> - Type check: ✅ / ❌
> - Lint: ✅ / ❌
> - Database review: ✅ / N/A
> - Code review: ✅
> - Documentation: ✅ / N/A
> - Plan fact-checked: ✅
> - `plan.html` refreshed: ✅
> - `diff-review.html` generated: ✅ / N/A
>
> The code has not been committed — you can commit when ready.

## Handling Issues During Guidance

- **User asks for help:** Provide hints, explain the API, show examples from the codebase — but don't write the implementation
- **User's implementation doesn't match plan:** If it works and passes tests, accept it. If it deviates significantly, note it
- **Tests keep failing:** Help debug — show how to read stack traces, suggest debugging approaches
- **User wants to deviate from plan:** Stop and confirm with user if they want to update the plan first

## Key Principles

1. **Tests first:** Always write tests before asking the user to implement
2. **Guide, don't implement:** You provide the API specification and tests; the user writes the code
3. **Verify continuously:** Check tests after each module implementation
4. **Be patient:** Wait for the user to implement — don't rush ahead
5. **Celebrate progress:** Acknowledge when tests pass, show progress through the plan

## Example Interaction Flow

```
AI: Let's implement the plan for cursor-pagination. I've written all tests upfront.

AI: ## Module: `src/api/pagination.ts`

### Class: `CursorPaginator`

**Purpose:** Handle cursor-based pagination for API responses

**Expected API:**
```typescript
class CursorPaginator<T> {
  constructor(items: T[], cursor?: string);
  getItems(): T[];
  getNextCursor(): string | null;
  hasMore(): boolean;
}
```

**Tests to satisfy:**
- `should return items for first page`
- `should return next cursor when more items exist`
- `should return null cursor when no more items`

Here are the specific tests:
[shows test code]

Please implement this class. Once done, tell me to 'check'.

User: Done, please check.

AI: Running tests... ❌ Test failed: "should return next cursor when more items exist"
Here's the error: <error details>
Looks like getNextCursor() is returning null. Can you check your logic?

User: Fixed it.

AI: Running tests... ✅ All 3 tests pass! Great job!
Let's move to the next module...
```

## Important Guidelines

- **Never write implementation code during coaching (Steps 1-5)** — that's the user's job
- **Always write tests first** — this is TDD coaching
- **Show, don't tell** — show the API, show the tests, show the errors
- **Wait for user** — don't implement modules ahead of time
- **Follow the plan** — use the approved plan as the specification
- **Post-completion cleanup is AI-driven (Steps 6-14)** — once tests pass and verification is clean, the AI handles cleanup, documentation, and visual artifacts directly. Findings from `database-reviewer` and `code-reviewer` are an exception: surface them to the user and guide them to fix, since the user owns the implementation code.
- **NEVER commit to version control** — no `git add`, `git commit`, or `git push`

## Visual Sync Guarantee

All visual HTML files in the feature directory MUST mirror their markdown counterparts at all times. The implement-coach skill is responsible for:

- **`plan.html`**: Regenerated after implementation to reflect final plan state (checked-off tasks, deviations noted). This is mandatory regardless of whether changes were detected.
- **`diff-review.html`**: Generated after implementation if `visual-explainer` is available. Summarizes what changed with executive summary, KPI dashboard, architecture comparison, and code review analysis.

If `visual-explainer` is not available, visual steps are silently skipped — the workflow proceeds with just the markdown artifacts.
