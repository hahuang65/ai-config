---
name: implement
description: Execute approved vertical-slice tasks from docs/claude/<slug>/tasks.md, slice by slice, using red-green-refactor TDD. Use after /tasks has produced an approved tasks.md.
argument-hint: [feature-dir-or-slug]
model: sonnet
---

# Implementation Phase

Execute approved vertical-slice tasks **one slice at a time** using strict red-green-refactor TDD. Each slice is a tracer bullet that cuts through every layer end-to-end.

## Prerequisites

- An approved `tasks.md` must exist in a feature directory under `docs/claude/`. The user will either:
  - Provide the directory path as `$ARGUMENTS` (e.g. `/implement docs/claude/20260227-1430-cursor-pagination/`)
  - Provide a slug or partial path you resolve
  - Or no argument — find the most recent `docs/claude/*/tasks.md` and confirm it's the right one
- The user has explicitly approved the tasks (do not assume approval)
- `CONTEXT.md` (at the repo root) and any relevant ADRs in `docs/adr/` have been read so test names and module names match the project's vocabulary

## Rules Adherence

Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow). The skill itself — not just the agents it invokes — must follow these rules.

## TDD Philosophy (non-negotiable)

This skill uses **vertical-slice TDD** — one test, one implementation, repeat. Do NOT write all tests upfront, then all implementation.

**Good tests** test behavior through public interfaces. They read like specifications — *what* the system does, not *how*. They survive refactors because they don't care about internal structure.

**Bad tests** couple to implementation. They mock internal collaborators, test private methods, or verify through side channels. Warning sign: a test that fails when you rename an internal function despite identical behavior.

**Anti-pattern to avoid:**
```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5
```

Tests written in bulk test *imagined* behavior, not *actual* behavior. They check the shape of things — data structures, signatures — rather than user-facing behavior.

**Correct pattern:**
```
RIGHT (vertical):
  RED→GREEN: test1 → impl1
  RED→GREEN: test2 → impl2
  RED→GREEN: test3 → impl3
  (refactor between cycles when GREEN)
```

Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

## Process

### Step 1: Read context

1. Read `tasks.md` thoroughly. Understand every slice, its acceptance criteria, and the dependency order.
2. Read the linked `prd.md` for surrounding context (user stories, decisions).
3. Read `CONTEXT.md` and any relevant ADRs.

### Step 2: For each slice (in dependency order)

Work one slice at a time. Do NOT batch multiple slices together — each slice gets its own RED→GREEN→REFACTOR cycle before the next slice begins.

For the current slice:

#### 2a. Confirm interface

Before writing any test, identify the public interface this slice will expose. Look for [deep modules](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/deep-modules.md) — small interface, deep implementation. The interface is what tests will exercise; everything behind it is free to refactor.

#### 2b. Tracer bullet

Write ONE test that confirms ONE thing about the slice's end-to-end behavior. This is the tracer bullet — it proves the path works through every layer.

```
RED:   Write the one test → it fails
GREEN: Write the minimal code that makes it pass → it passes
```

Use the `tdd-guide` agent (via the Agent tool) to guide this cycle.

#### 2c. Incremental loop

For each remaining acceptance criterion in this slice:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules per cycle:
- One test at a time
- Only enough code to pass the current test
- Don't anticipate future tests
- Tests must exercise the public interface, never internal state
- Tests must use vocabulary from `CONTEXT.md` (test names like `it("cancels an Order", ...)`, not `it("calls cancelOrder()", ...)`)

#### 2d. Refactor (only while GREEN)

After the slice's tests all pass, look for refactor opportunities:
- Extract duplication
- Deepen modules (move complexity behind simple interfaces)
- Apply SOLID where natural
- Run tests after every refactor step

**Never refactor while RED.** Get to GREEN first.

#### 2e. Per-slice checklist

Before marking the slice complete:
- [ ] Every test describes behavior, not implementation
- [ ] Every test uses the public interface only
- [ ] Every test would survive an internal refactor
- [ ] The code is minimal for the tests it satisfies
- [ ] No speculative features added beyond the acceptance criteria

#### 2f. Mark slice complete

Update `tasks.md`: check off the acceptance criteria boxes (`- [ ]` → `- [x]`) for the slice and append a `**Status:** ✅ Complete` line under the slice title.

Then move to the next slice. Do NOT stop to ask permission between slices — implementation should be boring at this point. Stop only if a slice cannot be implemented as written; in that case, surface the issue and wait for guidance.

### Step 3: Comprehensive verification

After all slices are done, run the systematic verification loop. This is not optional.

1. **Type check** — `npx tsc --noEmit`, `mypy`, `go vet`, `bundle exec srb tc`, etc.
2. **Lint** — `npx eslint .`, `ruff check .`, `rubocop`, `golangci-lint run`, etc.
3. **Test** — full test suite, all tests must pass
4. **Build** — if a build command exists (e.g. `npm run build`, `go build ./...`)

If any step fails, fix the issue (still TDD: add a failing test that reproduces it where applicable) and re-run the loop. Repeat until all four pass cleanly.

### Step 4: Database review *(conditional)*

If the implementation involved SQL queries, migrations, schema changes, or ORM operations, you MUST run the `database-reviewer` agent (via the Agent tool). Fix any CRITICAL or HIGH issues found.

### Step 5: Simplify

You MUST invoke `/simplify` to review changed code for reuse opportunities, quality issues, and efficiency improvements. Fix anything it surfaces. Re-run the test suite to confirm nothing broke.

### Step 6: Refactor cleanup

You MUST run the `refactor-cleaner` agent (via the Agent tool) on the changed files. Remove SAFE items, verify CAREFUL items. Re-run tests after cleanup.

### Step 7: Code review

You MUST run the `code-reviewer` agent (via the Agent tool) on all changed files. The agent reads and enforces the project's `rules/` files, applies confidence-based filtering, and reports findings by severity (including OWASP Top 10). Fix CRITICAL and HIGH issues. Re-run tests after fixes.

### Step 8: Documentation update *(conditional)*

If the implementation added new features, changed APIs, or modified architecture, run the `doc-updater` agent. Skip for trivial changes.

### Step 9: Fact-check the PRD and tasks

You MUST invoke `/fact-check` on both `prd.md` and `tasks.md`. This verifies that claims (module names, decisions, behavior descriptions) match what was actually implemented. Update either document if it drifted from the implementation.

### Step 10: Refresh visuals

Regenerate `prd.html` and `tasks.html` so they mirror the final markdown. Open them in the browser. Mandatory — the visuals MUST always mirror the markdown.

### Step 11: Generate diff review

If `visual-explainer` is available, generate a visual diff review via `/diff-review`: compare the current working tree against the branch point (typically `main`). Write to `diff-review.html` in the feature directory and open in the browser. Then run `/fact-check` on the generated HTML.

If `visual-explainer` is not available, skip silently.

### Step 12: Verify task-to-implementation sync

Read the final `tasks.md` and compare against the implementation:
- All acceptance criteria checked off (`- [x]`)
- Each slice marked `**Status:** ✅ Complete`
- Any deviation from the original slice documented in the slice body
- Both `tasks.html` and `prd.html` reflect the final state

### Step 13: Completion

Tell the user implementation is complete and summarize:
- Slices completed: <n>
- Tests added: <count>, all passing
- Type check / lint / build: ✅
- Code review findings addressed: <summary>
- `prd.html`, `tasks.html`, `diff-review.html` (if generated): refreshed

Do NOT commit to version control — leave that to the user.

## Handling Issues During Implementation

- **Minor issues**: fix and continue. Note the deviation in the slice body.
- **A slice can't be implemented as written**: STOP and tell the user. Wait for guidance.
- **Test failures during refactor**: revert the refactor step. Refactor must not change behavior.

## Feedback Loop

After implementation, the user may give terse corrections:
- Short and direct: "wider", "still cropped", "move this to the admin app"
- Act immediately — you have full context from the PRD and tasks; brief corrections are enough

When something goes wrong and the user reverts:
- Do not patch a bad approach
- Start fresh with the narrowed scope the user provides
- A clean restart almost always beats incremental fixes

## Referencing Existing Code

When the user references existing code ("make it look like the users table", "same pattern as the auth middleware"), read that reference and match it precisely. Most features in a mature codebase are variations on existing patterns.

## Important Guidelines

- **One slice at a time. One test at a time within a slice.** Vertical, not horizontal.
- Tests must verify behavior through public interfaces. Survive refactors.
- Test names and module names use `CONTEXT.md` vocabulary.
- Do NOT batch tests across slices. Do NOT batch implementations across tests.
- Do NOT add features beyond the slice's acceptance criteria.
- **NEVER commit to version control** — no `git add`, `git commit`, or `git push`. The user commits when ready.

## Visual Sync Guarantee

All visual HTML files in the feature directory MUST mirror their markdown counterparts at all times. The implement skill is responsible for:
- **`prd.html`** and **`tasks.html`**: regenerated after implementation if drift is detected (or to reflect completion status).
- **`diff-review.html`**: generated after implementation if `visual-explainer` is available.

If `visual-explainer` is not available, visual steps are silently skipped.
