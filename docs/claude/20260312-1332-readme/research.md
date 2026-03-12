# Research: ai-config Repository Structure and /build-feature Workflow

## Overview

This repository (`ai-config`, living at `~/.dotfiles/ai`) is a centralized configuration system for AI coding assistants. It manages skills, commands, agents, rules, and tool-specific settings for **two tools**: Claude Code (Anthropic's CLI) and OpenCode (an alternative AI coding TUI).

The repo is designed to be cloned once and installed via `./install.sh`, which symlinks everything into the right places for both tools. Claude Code's `settings.json` is the single source of truth for permissions; a sync script automatically generates OpenCode's config from it.

The centerpiece is the `/build-feature` workflow — a disciplined 3-phase process (Research → Plan → Implement) for building software features with AI assistance. The following sections describe how this pipeline works, the relationships between its components, and the infrastructure that supports it.

## The /build-feature Pipeline

All artifacts live in a feature directory: `docs/claude/<YYYYMMDD-HHMM>-<slug>/`

```text
docs/claude/20260312-1332-feature-name/
  research.md          Phase 1 — deep codebase analysis
  research.html        Phase 1 — visual companion
  plan.md              Phase 2 — implementation plan + todo list
  plan.html            Phase 2 — visual companion
  diff-review.html     Phase 3 — fact-checked diff review
```

### Phase 1: Research

**Entry**: `/build-feature [description]` or `/research [topic]`

1. Creates feature directory
2. Deep-reads the target codebase area exhaustively (every file, not just entry points)
3. Traces data flows end-to-end; identifies patterns, dependencies, edge cases
4. Writes `research.md`
   - Sections: Overview, Architecture, Key Files, Data Flow, Patterns & Conventions, Dependencies, Edge Cases & Gotchas, Current State
5. Generates `research.html` via visual-explainer (companion to `research.md`)
6. **STOPS — waits for user review**
7. **Annotation cycle**: User adds `//` comments → agent addresses every note → updates `research.md` → removes annotations
   - **Visual regeneration is mandatory** — `research.html` is regenerated after every cycle, even if the user says "move on"
   - Repeats until user says the research is acceptable

### Phase 2: Planning

**Entry**: User says "move to planning" or `/plan [description]`

1. Reads the research document and relevant source files
2. Invokes the **`architect` agent** (Opus) for design review if the feature is architectural
3. Auto-loads reference skills (`frontend-patterns`, `api-design`) if domain context detected
4. Writes `plan.md`
   - Sections: Goal, Research Reference, Approach, Detailed Changes (with code snippets per file), New Files, Dependencies, Considerations & Trade-offs, Migration/Data Changes, Testing Strategy
   - Includes a **Proposed Todo List** upfront (draft task checklist, not deferred until approval)
5. Generates `plan.html` via visual-explainer **before the first review prompt** (user sees markdown + visual together)
6. **STOPS — presents both `plan.md` and `plan.html` for review**
7. **Annotation cycle**: User adds `//` comments → agent updates plan (including Proposed Todo List if scope changes) → removes annotations
   - **Visual regeneration is mandatory** — `plan.html` is regenerated after every cycle, even if the user approves
   - Typically repeats 1–6 times
8. **On approval**: Proposed Todo List renamed to "Todo List" (finalized); `plan.html` regenerated one final time
9. **STOPS — waits for user to say "implement"**

### Phase 3: Implementation

**Entry**: User says "implement" or `/implement [plan-path]`

1. Reads the plan document thoroughly
2. Executes tasks via **`tdd-guide` agent** (Sonnet) in batches of 3–5 related tasks
3. Marks each task `[x]` in the plan as completed
4. Runs continuous type checks and linters
5. **Verification loop**: type check → lint → test suite → build (repeat until all pass)
6. Runs **`database-reviewer` agent** (Sonnet) if DB code was touched
7. Runs `/simplify` for reuse opportunities
8. Runs **`refactor-cleaner` agent** (Sonnet) for dead code removal
9. Runs **`code-reviewer` agent** (Sonnet) — OWASP Top 10, confidence >80% threshold
10. Runs **`doc-updater` agent** (Sonnet) if APIs/architecture changed
11. Runs `/fact-check` on the plan document
12. **Refreshes `plan.html`** — mandatory regeneration to reflect final state (checked-off tasks, deviations)
13. **Generates `diff-review.html`** via visual-explainer, then runs `/fact-check` on it
14. **Verifies plan-to-implementation sync** — all todo items checked off, detailed changes match implementation, deviations documented
15. **NEVER commits** — leaves that to the user

### Artifact Lifecycle

All artifacts live in the feature directory and can be:

- Kept for reference
- Committed alongside the feature (the git-workflow rule recommends this)
- Deleted after the feature ships
- Excluded via `.gitignore` on `docs/claude/`

## Skill → Rule → Agent Relationship Graph

The `/build-feature` skill is the root of a dependency graph that connects skills, rules, and agents:

```
/build-feature (orchestrator, disable-model-invocation)
├── research (skill, model: opus)
│   ├── Reads: all 6 rules (always-on context)
│   └── visual-explainer (skill) → generates research.html
│
├── plan (skill, model: opus)
│   ├── Reads: all 6 rules (always-on context)
│   ├── architect (agent, Opus) → design review
│   │   └── Reads: coding-style, testing, security, performance
│   ├── frontend-patterns (reference skill) → loaded if frontend detected
│   ├── api-design (reference skill) → loaded if API detected
│   └── visual-explainer (skill) → generates plan.html
│
└── implement (skill, model: sonnet)
    ├── Reads: all 6 rules (always-on context)
    ├── tdd-guide (agent, Sonnet) → TDD execution
    │   └── Reads: coding-style, testing
    ├── database-reviewer (agent, Sonnet) → conditional DB review
    │   └── Reads: coding-style, security, performance
    ├── refactor-cleaner (agent, Sonnet) → dead code removal
    │   └── Reads: coding-style
    ├── code-reviewer (agent, Sonnet) → security/quality review
    │   └── Reads: coding-style, testing, security, performance
    ├── doc-updater (agent, Sonnet) → conditional doc updates
    │   └── Reads: coding-style
    └── visual-explainer (skill) → generates plan.html, diff-review.html
```

**Key relationships:**
- **Skills read rules**: All 6 rules are loaded as always-on context in every Claude Code conversation. Skills inherit them automatically.
- **Agents read specific rules**: Each agent declares which rule files it reads before starting work. This is a subset — e.g., `tdd-guide` only reads `coding-style` and `testing`, not `security` or `performance`.
- **The plan skill requires plans to comply with rules**; the implement skill requires code to comply with rules.
- **Model routing**: Research and plan run on Opus for deep analysis. Implementation runs on Sonnet. Within implementation, the `architect` agent is the only Opus agent; all others are Sonnet.

## Patterns & Conventions

### Companion Naming Convention

Visual HTML files share the base name of their markdown counterpart:

- `research.md` → `research.html` (not `architecture.html`)
- `plan.md` → `plan.html` (not `visual-plan.html`)
- `diff-review.html` stands alone (no markdown counterpart)

The visual-explainer skill's output location documentation describes the rule: "When the visual is a companion to a markdown file, use the same base name with `.html` extension."

### Visual Sync Guarantee

A key invariant across the pipeline: **visual HTML files must always mirror their markdown counterparts.** Enforced at three levels:

1. **Research phase**: `research.html` regenerated after every annotation cycle — even if user says "move on"
2. **Plan phase**: `plan.html` regenerated after every annotation cycle — even if user approves. Regenerated one final time on approval.
3. **Implement phase**: `plan.html` regenerated after implementation completes — mandatory regardless of whether changes were detected

### Command/Skill Duality

Commands and skills that share a name (e.g., `build-feature`, `research`, `plan`, `implement`, `refactor`) register differently:

- **Claude Code**: Skills take precedence; `install.sh` skips commands with matching skill directories to avoid duplicate slash commands
- **OpenCode**: All commands are installed; skills are read from `~/.claude/skills/` (same location)

### Permission Design Philosophy

Permissions follow a "default-deny with explicit allows" model:

- **Allow**: Read-only operations (git status/log/diff, ls, grep, find), writing to `docs/claude/`, opening HTML in browser
- **Deny**: Destructive operations (rm, force push, deploy, terraform apply/destroy, credential access)
- **Ask**: Code modifications (git add/commit, editing files outside docs/claude/, reading .env files)

### Agent Model Routing

Agents are assigned models based on task complexity:

- **Opus**: `architect` — deep analysis, trade-offs, system design
- **Sonnet**: All others (`tdd-guide`, `code-reviewer`, `refactor-cleaner`, `database-reviewer`, `doc-updater`, `refactorer`) — implementation, review, cleanup

### Rule Enforcement Chain

Rules are enforced at multiple levels:

1. Rules are loaded as always-on context in every Claude Code conversation
2. Agents read specific rule files before starting work (e.g., code-reviewer reads coding-style, testing, security, performance)
3. The plan skill requires plans to comply with rules
4. The implement skill requires code to comply with rules

### Test Infrastructure

The `scripts/test-pipeline.sh` validates the repository's own internal consistency:

- Frontmatter validation (skills need name/description, agents need name/description/tools, commands need description)
- Phase content checks (research skill must mention "Deep-read", plan must mention "Todo List", etc.)
- Cross-reference validation (agent files referenced from skills must exist, visual-explainer paths in commands must exist)
- Agent rule dependency validation (rule files referenced in agent bodies must exist)
- Symlink target validation (all files that install.sh would symlink must exist)
- Guide/skill sync (HTML guide files must reference the same agents and commands as SKILL.md)
- Stale stub detection (short files with redirect language are flagged)

The `scripts/test-pipeline-self-test.sh` is a meta-test that creates intentionally broken files and verifies test-pipeline correctly catches each error class.

## Architecture

### Component Hierarchy

The repository has a layered architecture:

1. **Skills** (top-level workflows) — Multi-step processes invoked as slash commands. The orchestrator skill `build-feature` coordinates three sub-skills: `research`, `plan`, and `implement`. Two reference skills (`frontend-patterns`, `api-design`) provide domain-specific patterns loaded on demand. One standalone skill (`refactor`) handles code restructuring. The `visual-explainer` skill powers all HTML diagram generation.

2. **Commands** (single-action slash commands) — Markdown files with frontmatter that register as `/command-name` in both tools. These include visual generation commands (`/diff-review`, `/generate-architecture-diagram`, `/generate-visual-plan`, `/generate-slides`, `/generate-web-diagram`, `/plan-review`, `/project-recap`), verification (`/fact-check`), utility (`/model-route`), and workflow entry points (`/build-feature`, `/research`, `/plan`, `/implement`).

3. **Agents** (sub-agents for Claude Code) — Specialized AI agents invoked via the Agent tool during implementation. Each has a defined role, tool access, and model tier. Seven agents: `tdd-guide` (Sonnet), `code-reviewer` (Sonnet), `architect` (Opus), `refactor-cleaner` (Sonnet), `database-reviewer` (Sonnet), `doc-updater` (Sonnet), `refactorer` (Sonnet).

4. **Rules** (always-on constraints) — Six rule files loaded into every conversation: `coding-style.md`, `development-workflow.md`, `git-workflow.md`, `performance.md`, `security.md`, `testing.md`. These are non-negotiable — agents read and enforce them.

5. **Tool-specific config** — `claude/settings.json` (permissions, model, plugins, status line), `claude/hooks.json` (cost tracking hook), `opencode/opencode.jsonc` (auto-generated permissions), `opencode/tui.json` (theme).

### Dual-Tool Support

The repository serves two AI coding tools that have different config formats but share most functionality:

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Config location | `~/.claude/` | `~/.config/opencode/` |
| Skills | `~/.claude/skills/` (symlinked) | Same location (reads `~/.claude/skills/`) |
| Commands | `~/.claude/commands/` (symlinked) | `~/.config/opencode/commands/` (symlinked) |
| Agents | `~/.claude/agents/` (symlinked) | Not supported |
| Rules | `~/.claude/rules/` (symlinked) | Not supported |
| Permissions format | `"Bash(echo *)"` in JSON arrays | `"echo *": "allow"` in JSONC objects |
| Permission source of truth | `claude/settings.json` | Auto-generated via `sync-permissions.py` |
| Hooks | `claude/hooks.json` (cost tracker) | Not supported |

### Permission Sync Pipeline

The `scripts/sync-permissions.py` script is the bridge between the two tools:

1. Reads `claude/settings.json` (source of truth)
2. Parses Claude's `Tool(pattern)` format (e.g., `Bash(echo *)`)
3. Maps tools to OpenCode equivalents via `TOOL_MAP` (Bash→bash, Read→read, Write→write, Edit→edit, WebFetch→webfetch, WebSearch→websearch)
4. Skips Claude-specific tools with no OpenCode equivalent (`Search`, `Glob`, `Grep`, `Task`)
5. Merges with `config/opencode-only.json` for OpenCode-specific entries (e.g., `cat *`, `head *`, `tail *`, `brew *`, `npm list`)
6. Writes the combined result to `opencode/opencode.jsonc`

This runs automatically on every commit via the `.githooks/pre-commit` hook, and also during `./install.sh`. If the sync changes `opencode.jsonc`, the pre-commit hook auto-stages it.

### Install Flow

`install.sh` performs these operations:

1. **Skills** → symlinked to `~/.claude/skills/` (shared by both tools)
2. **Rules** → symlinked to `~/.claude/rules/`
3. **Commands for Claude Code** → symlinked to `~/.claude/commands/`, skipping commands that have a matching skill directory (to avoid duplicate slash command registration)
4. **Commands for OpenCode** → symlinked to `~/.config/opencode/commands/` (all commands)
5. **Agents** → symlinked to `~/.claude/agents/`
6. **Claude Code config** → `settings.json`, `statusline.sh`, `hooks.json` symlinked to `~/.claude/`
7. **Git hooks** → `core.hooksPath` set to `.githooks`
8. **Permission sync** → runs `sync-permissions.py`
9. **OpenCode config** → `opencode.jsonc`, `tui.json` symlinked to `~/.config/opencode/`

## Key Files

| File | Role |
|------|------|
| `install.sh` | Entry point — symlinks everything to the right locations |
| `claude/settings.json` | Claude Code config: permissions (source of truth), model (opus), plugins, status line |
| `claude/hooks.json` | Cost tracking hook (logs to `~/.claude/metrics/costs.jsonl`) |
| `claude/statusline.sh` | Status bar showing session ID, token usage, cost, git branch, working directory |
| `opencode/opencode.jsonc` | Auto-generated OpenCode config (never edit directly) |
| `opencode/tui.json` | OpenCode TUI theme (catppuccin) |
| `config/opencode-only.json` | OpenCode-specific permissions and top-level settings merged during sync |
| `scripts/sync-permissions.py` | Converts Claude permissions to OpenCode format |
| `scripts/test-pipeline.sh` | Validates pipeline integrity: frontmatter, phase content, cross-references, stale stubs |
| `scripts/test-pipeline-self-test.sh` | Meta-test: creates intentionally broken files to verify test-pipeline catches errors |
| `.githooks/pre-commit` | Runs test-pipeline validation and permission sync before commits |
| `.builds/mirror.yml` | sr.ht CI: mirrors to GitHub on push |
| `skills/build-feature/SKILL.md` | Orchestrator: 3-phase workflow entry point |
| `skills/research/SKILL.md` | Phase 1: deep codebase investigation (model: opus) |
| `skills/plan/SKILL.md` | Phase 2: implementation planning (model: opus) |
| `skills/implement/SKILL.md` | Phase 3: TDD implementation (model: sonnet) |
| `skills/visual-explainer/SKILL.md` | HTML diagram generation engine |
| `skills/refactor/SKILL.md` | Standalone refactoring workflow |
| `skills/frontend-patterns/SKILL.md` | Reference patterns for frontend development |
| `skills/api-design/SKILL.md` | Reference patterns for REST API design |

## Dependencies

### External tools

- `jq` — used by statusline.sh and cost-tracker.sh
- `python3` — used by sync-permissions.py and cost-tracker.sh
- `git` — used throughout for version control operations

### Claude Code features used

- Skills (SKILL.md with frontmatter)
- Commands (markdown with frontmatter)
- Agents (markdown with frontmatter, model routing)
- Hooks (Stop hook for cost tracking)
- Status line (custom bash script)
- Plugins (lua-lsp, ruby-skills, ruby-lsp, astral, bash-language-server, terraform-ls)
- Settings (permissions, model selection)

### CI/CD

- sr.ht builds (`.builds/mirror.yml`) — mirrors to GitHub on push

## Edge Cases & Gotchas

1. **Command/skill name collision**: `install.sh` skips commands with matching skill directories for Claude Code only. OpenCode gets all commands regardless. This means OpenCode may have two entry points for the same workflow.

2. **OpenCode limitations**: OpenCode doesn't support agents, rules, or hooks. Skills work because they use `~/.claude/skills/` which OpenCode also reads. The visual-explainer and multi-agent implementation pipeline are degraded in OpenCode.

3. **Permission sync is one-directional**: Claude → OpenCode only. If you edit `opencode.jsonc` directly, changes will be overwritten on next commit.

4. **Pre-commit hook runs sync**: The permission sync runs on every commit, not just when permissions change. This means `opencode.jsonc` gets re-staged on every commit if there's any diff.

5. **docs/claude/ permissions**: Both tools auto-allow writing to `docs/claude/` and `*/docs/claude/`. This is intentional — the build-feature pipeline writes research documents, plans, and HTML diagrams there without asking permission.

6. **Model selection**: Claude Code is configured to use Opus by default (`"model": "opus"` in settings.json). Agents override this with their own model assignments (most use Sonnet).

7. **Visual-explainer is optional**: All visual steps in the pipeline degrade gracefully. The workflow produces markdown artifacts regardless; HTML companions are bonuses when visual-explainer is installed.

## Current State

The repository is actively maintained with recent feature work visible in `docs/claude/` (pipeline testing framework, skill token reduction, rules token optimization). The test infrastructure (`test-pipeline.sh` and its self-test) validates internal consistency. The permission sync pipeline keeps Claude Code and OpenCode config in sync automatically. The `.builds/mirror.yml` mirrors the repo from sr.ht to GitHub.
