# Research: Skill & Agent for Code Refactoring

## Overview

The goal is to create a **refactoring skill** (user-invocable via `/refactor`) and a supporting **refactoring agent** that can perform structured code refactors on any given codebase. This document captures how the existing skill/agent system works, what patterns to follow, and what the new components need to do.

The existing system already has refactoring-adjacent capabilities scattered across several agents (`refactor-cleaner`, `code-reviewer`, `architect`) and a built-in `/simplify` skill, but none of them perform **intentional, user-directed code refactoring** — transforming code structure while preserving behavior, guided by a specific refactoring goal.

## Architecture

### System Layers

```
User
  ↓ /refactor [description]
Skill (skills/refactor/SKILL.md)          ← orchestrates the workflow
  ↓ Agent tool
Agent (agents/refactorer.md)              ← does the actual refactoring work
  ↓ reads
Rules (rules/coding-style.md, etc.)       ← enforced constraints
```

### How Skills Work

Skills are **markdown files with YAML frontmatter** at `skills/<name>/SKILL.md`. They are symlinked to `~/.claude/skills/<name>/` by `install.sh`. Claude Code registers each skill directory as a slash command (`/skill-name`).

**Frontmatter fields:**

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Identifier (lowercase, hyphens) |
| `description` | Yes | One-line user-facing description; also used for trigger matching |
| `argument-hint` | No | Placeholder shown in autocomplete (e.g., `[feature-description]`) |
| `model` | No | `opus`, `sonnet`, or `haiku` — defaults to sonnet |
| `disable-model-invocation` | No | Set `true` for orchestrators that only invoke sub-skills |
| `tools` | No | Restrict tool access (array of tool names) |

**Body:** Markdown instructions to the AI. These are injected into the conversation when the skill is invoked. The body can reference `$ARGUMENTS` (substituted with the user's input after the slash command).

### How Agents Work

Agents are **markdown files with YAML frontmatter** at `agents/<name>.md`. They are symlinked to `~/.claude/agents/` by `install.sh`. They are invoked from skills (or directly) via Claude Code's `Agent` tool with `subagent_type` matching the agent's `name`.

**Frontmatter fields:**

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Identifier — must match `subagent_type` when invoking |
| `description` | Yes | What the agent does; Claude Code uses this to match `subagent_type` |
| `tools` | Yes | JSON array of allowed tools (e.g., `["Read", "Write", "Edit", "Bash", "Grep", "Glob"]`) |
| `model` | No | `opus` or `sonnet` — defaults to sonnet |

**Body:** System instructions for the agent. Defines role, workflow, constraints, and output format. Agents typically start by reading project rules from `rules/`.

### How Commands Work

Commands are **markdown files with YAML frontmatter** at `commands/<name>.md`. They are symlinked to `~/.claude/commands/` (and `~/.config/opencode/commands/`). Commands that share a basename with a skill are **skipped** during install (skills take precedence since Claude Code registers both as slash commands).

**Frontmatter:** Only `description` is required. May include `name` and `argument-hint`.

**Body:** Instructions + `$ARGUMENTS` placeholder. Commands are simpler than skills — they don't have their own directory or supporting files.

### Registration & Installation

`install.sh` handles all symlinks:

- `skills/*/` → `~/.claude/skills/`
- `agents/*.md` → `~/.claude/agents/`
- `commands/*.md` → `~/.claude/commands/` (skips if matching skill exists)
- `rules/*.md` → `~/.claude/rules/`
- `claude/settings.json` → `~/.claude/settings.json`

### Pipeline Integrity Testing

`scripts/test-pipeline.sh` validates the entire system:

- Frontmatter presence and correctness for all skills, agents, commands
- Tool names in agent frontmatter are known valid tools
- Cross-references between skills and agents resolve to existing files
- Agent rule dependencies (`rules/*.md` references) point to existing files
- Visual-explainer reference paths resolve
- Stale stub detection (short files with redirect language)
- Guide/skill sync (HTML guide files match SKILL.md content)

**Any new skill/agent must pass these tests.** The test script pattern-matches agent names referenced in skill files and verifies the corresponding `agents/<name>.md` exists.

## Key Files

| File | Role |
|------|------|
| `skills/*/SKILL.md` | Skill definitions (7 existing skills) |
| `agents/*.md` | Agent definitions (6 existing agents) |
| `commands/*.md` | Command definitions (13 existing commands) |
| `rules/*.md` | Enforced coding rules (6 rule files) |
| `install.sh` | Symlink installer |
| `scripts/test-pipeline.sh` | Pipeline integrity tests |

### Existing Refactoring-Adjacent Components

| Component | Type | What It Does | Gap |
|-----------|------|-------------|-----|
| `refactor-cleaner` | Agent | Dead code removal, unused dependency cleanup | Only removes; doesn't restructure |
| `code-reviewer` | Agent | Reviews for quality, security, performance | Finds problems; doesn't fix structural ones |
| `architect` | Agent | System design, trade-off analysis | Advisory only; doesn't transform code |
| `/simplify` | Built-in skill | Reviews changed code for reuse and quality | Post-hoc cleanup; not goal-directed refactoring |
| `tdd-guide` | Agent | Red-green-refactor TDD cycle | The "refactor" step is incidental, not the focus |

## Data Flow

### Existing Feature Pipeline

```
/build-feature → research → plan → implement
                                     ├── tdd-guide (batched 3-5 tasks)
                                     ├── database-reviewer (if DB code)
                                     ├── /simplify
                                     ├── refactor-cleaner
                                     ├── code-reviewer
                                     ├── doc-updater
                                     └── /fact-check
```

### Proposed Refactoring Flow

```
/refactor [goal]
  1. Analyze: read target code, understand structure
  2. Plan: identify specific transformations needed
  3. Transform: apply changes incrementally (test between steps)
  4. Verify: run tests, type-check, lint after all transforms
  5. Review: summarize what changed and why
```

The refactoring skill does NOT need the full build-feature pipeline (research docs, annotation cycles, visual diagrams). Refactoring is a focused, single-session activity. But it DOES need:

- Test verification at each step (behavior must be preserved)
- Incremental changes (not a big-bang rewrite)
- Awareness of project rules (coding-style constraints)

## Patterns & Conventions

### Skill Patterns (from existing skills)

1. **File naming**: `skills/<name>/SKILL.md` — one directory per skill
2. **Frontmatter**: YAML with `name`, `description`, optional `model`, `argument-hint`
3. **$ARGUMENTS**: User input substituted at invocation time
4. **Agent delegation**: Skills invoke agents via the `Agent` tool for specialized work
5. **Rule adherence**: Skills and agents reference `rules/` files as mandatory constraints
6. **Stop points**: Skills that produce artifacts STOP and wait for user review before proceeding
7. **Verification loop**: Implementation skills run type-check → lint → test → build
8. **No commits**: Skills never commit to version control — left to the user

### Agent Patterns (from existing agents)

1. **Opening line**: "You are a [role] specialist focused on [responsibility]."
2. **Project Rules section**: Mandatory — lists which `rules/*.md` files to read
3. **Workflow**: Numbered steps with clear phases (analyze → verify → act)
4. **Risk categorization**: Actions categorized by risk level (SAFE, CAREFUL, RISKY)
5. **Safety rules**: Explicit "when uncertain, don't do it" guardrails
6. **Review checklist**: Checklist format for verification at the end
7. **Confidence-based filtering**: Only report/act when >80% confident
8. **Tools declaration**: Explicit tool list in frontmatter — minimum necessary permissions

### Model Selection

- **Opus**: For architecture decisions, deep analysis, ambiguous requirements (architect, plan, research)
- **Sonnet**: For standard implementation, review, cleanup work (implement, code-reviewer, tdd-guide, refactor-cleaner)

Refactoring involves understanding code structure deeply (Opus-like) but also making concrete code changes (Sonnet-like). The **skill** should use **opus** (analysis and planning of the refactoring strategy) while the **agent** should use **sonnet** (executing the transformations).

## Dependencies

### Internal Dependencies

The new skill/agent will depend on:

- `rules/coding-style.md` — enforced constraints on the refactored code
- `rules/testing.md` — TDD discipline during refactoring
- Test infrastructure in the target project (language-specific test runners)
- Linters/type-checkers in the target project

### No External Dependencies

The skill operates on whatever codebase the user is working in. It must be **language-agnostic** — detect the project's language and use appropriate tools (linters, type checkers, test runners).

## Edge Cases & Gotchas

### Scope Control

The biggest risk with automated refactoring is **scope creep** — a simple "extract this method" turning into a cascade of changes across 20 files. The skill must:

- Ask the user to confirm scope before starting
- Work incrementally (one transformation at a time)
- Run tests after each transformation
- Stop if tests fail and let the user decide

### Behavior Preservation

Refactoring means **changing structure without changing behavior**. The agent must:

- Never add features during a refactor
- Never change public API signatures unless explicitly asked
- Run the full test suite after each step
- Flag any behavioral change it detects

### Language Detection

The agent must detect the project language to:

- Run the correct test suite (`npm test`, `pytest`, `rspec`, `go test`, etc.)
- Run the correct linter (`eslint`, `ruff`, `rubocop`, `golangci-lint`, etc.)
- Run the correct type checker (`tsc`, `mypy`, `sorbet`, `go vet`, etc.)
- Understand language-specific refactoring patterns

### Interaction with Existing Pipeline

The refactoring skill should be **standalone** — invocable independently of the build-feature pipeline. However, it should be composable with the pipeline:

- `/implement` could invoke the refactoring agent for tasks tagged as refactors
- `refactor-cleaner` handles post-implementation cleanup (a different concern)
- The refactoring skill handles intentional structural improvements

### Common Refactoring Operations

The skill should support these categories (with language-specific implementations):

| Category | Examples |
|----------|----------|
| **Extract** | Extract method, extract class, extract module, extract constant |
| **Inline** | Inline method, inline variable, inline class |
| **Move** | Move method to another class, move file, move module |
| **Rename** | Rename with all references updated |
| **Restructure** | Split file (>400 LOC), flatten nesting, simplify conditionals |
| **Pattern** | Replace inheritance with composition, introduce strategy pattern |
| **Decouple** | Remove circular dependencies, introduce interfaces |

### What NOT to Build

- **AST-based transformations**: Claude operates on text, not ASTs. The agent reads and edits files directly — this is sufficient and language-agnostic.
- **IDE integration**: This runs in Claude Code CLI. No LSP, no code actions, no refactoring preview UI.
- **Automated refactoring detection**: The user tells the skill what to refactor. The skill doesn't scan the codebase for refactoring opportunities (that's what `code-reviewer` and `refactor-cleaner` already do).

## Current State

### What Exists

- The skill/agent infrastructure is mature and well-tested
- Pipeline integrity tests validate cross-references and structure
- 6 agents and 7 skills are already installed and working
- The `refactor-cleaner` agent handles post-hoc cleanup (dead code, unused deps)
- The `code-reviewer` agent identifies structural problems but doesn't fix them
- The `/simplify` built-in skill does light quality improvements

### What's Missing

- **No user-directed refactoring workflow**: There's no way to say "extract this service class" or "split this 600-line file" and have it happen with test verification at each step
- **No incremental transformation tracking**: The system can plan and implement features, but refactoring needs step-by-step verification that behavior is preserved
- **No refactoring-specific safety model**: The existing risk categories (SAFE/CAREFUL/RISKY) in `refactor-cleaner` are about deletion risk, not transformation risk

### Design Decisions to Make During Planning

1. **Skill model**: Opus for the skill (analysis), sonnet for the agent (execution) — or sonnet for both?
2. **Scope confirmation**: Should the skill always show a transformation plan before executing, or allow "just do it" mode for simple refactors?
3. **Test granularity**: Run tests after every single file change, or after each logical transformation (which may span multiple files)?
4. **Integration with implement**: Should `/implement` be able to delegate refactoring tasks to the new agent, or keep them separate?
5. **Artifact output**: Should the skill produce a persistent document (like research/plan skills) or just transform code and report results?

## Verification Summary

- Reviewed all 7 existing skills (research, plan, implement, build-feature, visual-explainer, api-design, frontend-patterns)
- Reviewed all 6 existing agents (architect, code-reviewer, tdd-guide, refactor-cleaner, database-reviewer, doc-updater)
- Reviewed 5 commands (diff-review, fact-check, model-route, project-recap, build-feature)
- Reviewed install.sh registration mechanism
- Reviewed scripts/test-pipeline.sh validation rules
- Reviewed all 6 rule files referenced by agents
- Confirmed the skill/agent frontmatter format from multiple examples
- Confirmed the pipeline integrity test requirements for new components
