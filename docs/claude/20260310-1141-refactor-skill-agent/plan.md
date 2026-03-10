# Plan: /refactor Skill & Refactorer Agent

## Goal

Create a `/refactor` skill and `refactorer` agent that perform user-directed, behavior-preserving code refactors on any codebase — with incremental test verification at each transformation step.

## Research Reference

`docs/claude/20260310-1141-refactor-skill-agent/research.md`

## Approach

Two new files, zero modifications to existing files:

1. **`skills/refactor/SKILL.md`** — The user-facing skill. Parses the user's refactoring goal, reads target code, presents a transformation plan, then delegates execution to the `refactorer` agent. Uses **sonnet** model — refactoring is focused execution, not ambiguous architecture.

2. **`agents/refactorer.md`** — The execution agent. Receives a refactoring goal + scope, applies incremental transformations, runs tests between each step, and reports results. Uses **sonnet** model with full read/write tools.

**Key design decisions:**

- **Always plan first.** The skill reads target code, identifies transformations, and presents a numbered list to the user before executing. No "just do it" mode — even simple renames can cascade.
- **Test after each logical transformation**, not after every file edit. A single "extract class" may touch 3 files — test once after all 3 are updated.
- **Standalone, not integrated with /implement.** The `/implement` skill already has `refactor-cleaner` for cleanup. This skill is for intentional structural improvements the user directs.
- **No persistent artifacts.** Unlike `/research` and `/plan`, this skill doesn't produce markdown documents in `docs/claude/`. Refactoring is a focused operation — results are the transformed code itself.
- **Language-agnostic.** The agent detects the project language and uses appropriate test/lint/type-check commands.

## Detailed Changes

### New File: `skills/refactor/SKILL.md`

The skill orchestrates the workflow. Structure follows existing skill patterns (frontmatter + markdown body).

```yaml
---
name: refactor
description: Perform user-directed code refactoring with incremental test verification. Use when restructuring code while preserving behavior — extract methods, split files, rename across codebase, simplify conditionals, decouple modules.
argument-hint: [refactoring-goal]
model: sonnet
---
```

**Body structure:**

1. **Parse goal** — Read `$ARGUMENTS` to understand what the user wants refactored.
2. **Read target code** — Read the files/modules the user referenced. If the user gave a vague scope ("clean up the auth module"), use Grep/Glob to identify all relevant files.
3. **Detect project tooling** — Identify language, test runner, linter, type checker by checking for config files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `Makefile`, etc.).
4. **Present transformation plan** — List the specific transformations that will be applied, numbered, with the files affected by each. Show what changes and why. This is NOT a persistent document — it's presented in chat for the user to approve or adjust.
5. **Wait for user confirmation** — STOP and ask the user to confirm, adjust, or cancel. Do not proceed without explicit approval.
6. **Execute via agent** — Invoke the `refactorer` agent with the confirmed transformation plan and project tooling info.
7. **Final verification** — After the agent completes, run the full verification loop (type-check → lint → test → build).
8. **Report** — Summarize what changed: files modified, transformations applied, tests passing. Do NOT commit.

**Scope control rules** (embedded in skill):

- Maximum scope: the skill should warn if a refactoring would touch more than 15 files and suggest breaking it into phases.
- If the user's goal is vague, ask for clarification rather than guessing.
- Never add features during a refactor. Never change public API signatures unless the user explicitly asked.

**Verification loop** (same pattern as `/implement`):

1. Type check
2. Lint
3. Test (full suite)
4. Build (if applicable)

If any step fails, fix and repeat until clean.

### New File: `agents/refactorer.md`

The agent does the actual code transformations. Structure follows existing agent patterns.

```yaml
---
name: refactorer
description: Code refactoring specialist that applies structural transformations while preserving behavior. Use for extract, inline, move, rename, restructure, and decoupling operations with incremental test verification.
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---
```

**Body structure:**

Opening: "You are a code refactoring specialist focused on structural transformations that preserve behavior."

**Project Rules section** (mandatory per agent pattern):

- `rules/coding-style.md`
- `rules/performance.md`
- `rules/security.md`
- `rules/testing.md`

**Test preservation rule** (critical safety constraint):
- The agent MUST NOT modify or remove any existing tests. It may only ADD new tests.
- If a refactoring makes an existing test invalid (e.g., a renamed function breaks an import in a test file), the agent MUST stop and present the required test changes to the user for approval before proceeding.
- This prevents silent behavioral changes from hiding behind "updated tests."

**Supported refactoring categories** (reference table for the agent):

| Category | Operations |
|----------|-----------|
| Extract | Method, class, module, constant, variable |
| Inline | Method, variable, class |
| Move | Function to another file, file to another directory |
| Rename | Variable, function, class, file — with all references updated |
| Restructure | Split file (>400 LOC), flatten nesting, simplify conditionals, remove duplication |
| Pattern | Replace inheritance with composition, introduce strategy/factory |
| Decouple | Remove circular dependencies, introduce interfaces/abstractions |

**Transformation risk categories** (adapted from refactor-cleaner's model):

| Risk | Description | Action |
|------|-------------|--------|
| **SAFE** | Internal renaming, extracting private methods, simplifying expressions | Apply directly, test after |
| **CAREFUL** | Changing file boundaries, moving public functions, restructuring modules | Verify all callers updated, test after each |
| **RISKY** | Changing public API signatures, modifying shared interfaces, pattern changes | Only if explicitly requested, verify extensively |

**Workflow:**

1. **Receive plan** — Read the transformation plan passed from the skill.
2. **Run baseline tests** — Run the test suite BEFORE making any changes. If tests fail before refactoring, STOP and report — don't refactor broken code.
3. **Execute transformations** — Apply each transformation incrementally:
   - For each logical transformation (numbered step from the plan):
     a. Make the code changes
     b. Run the test suite
     c. If tests fail: revert the transformation and report the failure
     d. If tests pass: proceed to next transformation
4. **Post-refactoring cleanup** — After all transformations complete:
   - Remove any unused imports created by moves/extractions
   - Run linter to catch style issues
   - Run type checker if available
5. **Report results** — For each transformation: what changed, which files were affected, tests status.

**Safety rules:**

- Never change behavior. If a transformation would change behavior, STOP and report.
- Never add features. The refactored code must do exactly what the original code did.
- Never modify or remove existing tests. Only add new tests. If a refactoring would break an existing test (e.g., renamed import), STOP and present the required test changes to the user for approval.
- When uncertain, don't transform. Flag it and let the skill/user decide.
- Always verify with grep that all references are updated after renames/moves.
- Run tests after each logical transformation, not just at the end.

**Revert protocol:**

- If a transformation causes test failures, revert ALL changes from that transformation (not just the last file edit).
- Report which transformation failed and why.
- Continue with remaining transformations only if they don't depend on the failed one.

## New Files

| File | Purpose |
|------|---------|
| `skills/refactor/SKILL.md` | User-facing refactoring skill |
| `agents/refactorer.md` | Execution agent for code transformations |

No command file needed — skills are auto-registered as slash commands. `install.sh` already handles new `skills/*/` and `agents/*.md` via wildcard globs.

## Dependencies

None. No new libraries, services, or external tools. The skill/agent use the project's existing test runner, linter, and type checker.

## Considerations & Trade-offs

### Why sonnet for both skill and agent (not opus for skill)?

The research suggested opus for the skill's analysis phase. However:

- The user provides the refactoring goal — the skill doesn't need to invent one
- Code reading and transformation planning is standard reasoning, not deep architecture
- Sonnet handles 90% of tasks well, and refactoring is focused execution
- Using sonnet for both keeps the system consistent with `/implement` (also sonnet)
- The user can always invoke `/refactor` from an opus session if needed

### Why no persistent artifacts?

Unlike `/research` (which produces knowledge) and `/plan` (which produces a specification), `/refactor` produces **transformed code**. The code IS the artifact. Adding a markdown document would be overhead without value — the git diff tells the story.

### Why not integrate with /implement?

The `/implement` skill is plan-driven: it executes a pre-approved specification. Refactoring is goal-driven: the user says "split this file" and the agent figures out how. Different mental models, different workflows. Keeping them separate avoids muddying either one.

### Why always show a plan first?

Even simple refactors can cascade. "Rename this function" touches every caller. "Split this file" changes import paths across the codebase. Showing the plan lets the user catch scope issues before execution. The overhead is minimal — a few seconds to read a numbered list.

## Migration / Data Changes

None.

## Testing Strategy

The skill and agent are markdown files — they don't have unit tests. Validation is done by the pipeline integrity test (`scripts/test-pipeline.sh`), which checks:

### Test File: `scripts/test-pipeline.sh`

**Test case 1: Skill frontmatter validation**

- Scenario: `skills/refactor/SKILL.md` exists with `name:` and `description:` in frontmatter
- Expected: Both fields present, test passes

**Test case 2: Agent frontmatter validation**

- Scenario: `agents/refactorer.md` exists with `name:`, `description:`, and `tools:` in frontmatter
- Expected: All three fields present, test passes

**Test case 3: Agent tool names are valid**

- Scenario: Tools listed in `agents/refactorer.md` frontmatter are checked against `KNOWN_TOOLS`
- Expected: All tools (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`) are in the known list

**Test case 4: Cross-reference from skill to agent**

- Scenario: `skills/refactor/SKILL.md` references `refactorer` agent by name
- Expected: `agents/refactorer.md` exists, cross-reference resolves

**Test case 5: Agent rule dependencies**

- Scenario: `agents/refactorer.md` body references `rules/coding-style.md` and `rules/testing.md`
- Expected: Both rule files exist at `rules/coding-style.md` and `rules/testing.md`

**Test case 6: Stale stub detection**

- Scenario: Both new files have more than 5 non-empty lines and no redirect language
- Expected: Neither is flagged as a stale stub

**Test case 7: Symlink installation**

- Scenario: After running `install.sh`, `~/.claude/skills/refactor/` and `~/.claude/agents/refactorer.md` exist
- Expected: Both symlinks point to the correct source files

## Todo List

### Phase 1: Create the refactorer agent
- [x] Write `agents/refactorer.md` with frontmatter (`name`, `description`, `tools`, `model`)
- [x] Write agent body: opening line, Project Rules section, test preservation rule
- [x] Write agent body: supported refactoring categories table
- [x] Write agent body: transformation risk categories table
- [x] Write agent body: workflow (receive plan, baseline tests, execute, cleanup, report)
- [x] Write agent body: safety rules including test preservation
- [x] Write agent body: revert protocol
- [x] Write agent body: review checklist

### Phase 2: Create the refactor skill
- [x] Create `skills/refactor/` directory
- [x] Write `skills/refactor/SKILL.md` with frontmatter (`name`, `description`, `argument-hint`, `model`)
- [x] Write skill body: parse goal from `$ARGUMENTS`
- [x] Write skill body: read target code step
- [x] Write skill body: detect project tooling step
- [x] Write skill body: present transformation plan step
- [x] Write skill body: wait for user confirmation (STOP point)
- [x] Write skill body: execute via `refactorer` agent
- [x] Write skill body: final verification loop (type-check, lint, test, build)
- [x] Write skill body: report and "do not commit" guard
- [x] Write skill body: scope control rules
- [x] Write skill body: handling issues / feedback loop section

### Phase 3: Validate
- [x] Run `scripts/test-pipeline.sh` and verify all checks pass for the new files
- [x] Run `install.sh` and verify symlinks are created at `~/.claude/skills/refactor/` and `~/.claude/agents/refactorer.md`
