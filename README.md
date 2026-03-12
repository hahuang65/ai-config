# ai-config

Centralized configuration for AI coding assistants — Claude Code and OpenCode.

## Quick Start

```sh
git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

## The /build-feature Workflow

The centerpiece of this repository is `/build-feature` — a disciplined 3-phase workflow (Research → Plan → Implement) for building software features with AI assistance. It enforces a "think before you code" discipline:

1. deep-read the codebase first
2. write a detailed plan with iterative user review
3. implement with TDD and multi-agent verification.

All artifacts live in a feature directory:

```text
docs/claude/<YYYYMMDD-HHMM>-<slug>/
  research.md          Phase 1 — deep codebase analysis
  research.html        Phase 1 — visual companion
  plan.md              Phase 2 — implementation plan + todo list
  plan.html            Phase 2 — visual companion
  diff-review.html     Phase 3 — fact-checked diff review
```

### Phase 1: Research

**Entry**: `/build-feature [description]` or `/research [topic]`

1. Creates feature directory under `docs/claude/`
2. Deep-reads the target codebase area exhaustively (every file, not just entry points)
3. Traces data flows end-to-end; identifies patterns, dependencies, edge cases
4. Writes `research.md`
   - Sections: Overview, Architecture, Key Files, Data Flow, Patterns & Conventions, Dependencies, Edge Cases & Gotchas, Current State
5. Generates `research.html` via visual-explainer (companion to `research.md`)
6. **STOPS — waits for user review**
7. **Annotation cycle**: user adds `//` comments → agent addresses every note → updates `research.md` → removes annotations
   - **Visual regeneration is mandatory** — `research.html` is regenerated after every cycle, even if the user says "move on"
   - Repeats until user says the research is acceptable

### Phase 2: Plan

**Entry**: User says "move to planning" or `/plan [description]`

1. Reads the research document and relevant source files
2. Invokes the **`architect` agent** (Opus) for design review if the feature is architectural
3. Auto-loads reference skills (`frontend-patterns`, `api-design`) if domain context detected
4. Writes `plan.md`
   - Sections: Goal, Research Reference, Approach, Detailed Changes (with code snippets per file), New Files, Dependencies, Considerations & Trade-offs, Migration/Data Changes, Testing Strategy
   - Includes a **Proposed Todo List** upfront (draft task checklist, not deferred until approval)
5. Generates `plan.html` via visual-explainer **before the first review prompt** (user sees markdown + visual together)
6. **STOPS — presents both `plan.md` and `plan.html` for review**
7. **Annotation cycle**: user adds `//` comments → agent updates plan (including Proposed Todo List if scope changes) → removes annotations
   - **Visual regeneration is mandatory** — `plan.html` is regenerated after every cycle, even if the user approves
   - Typically repeats 1–6 times
8. **On approval**: Proposed Todo List renamed to "Todo List" (finalized); `plan.html` regenerated one final time
9. **STOPS — waits for user to say "implement"**

### Phase 3: Implement

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

### Annotation Cycles

Both research and plan phases use the same annotation convention. To provide feedback, add `//` comments anywhere in the markdown file:

```markdown
### `src/api/users.ts`

// this should be a PATCH, not a PUT
- Update the `updateUser` handler to accept partial updates via PUT

// remove this section entirely
- Add Redis caching layer for user lookups
```

The agent addresses every annotation, updates the document, removes the `//` comments, and regenerates the visual companion. This cycle repeats until the user explicitly approves.

### Visual Sync Guarantee

Visual HTML companions must always mirror their markdown counterparts. Regeneration is mandatory:

- **Research phase**: after every annotation cycle — even if the user says "move on"
- **Plan phase**: after every annotation cycle — even if the user approves. One final regeneration on approval.
- **Implement phase**: after implementation completes — mandatory regardless of whether changes were detected

### Artifact Lifecycle

Feature artifacts can be:

- Kept for reference
- Committed alongside the feature (the git-workflow rule recommends this)
- Deleted after the feature ships
- Excluded via `.gitignore` on `docs/claude/`

## Skill / Rule / Agent Graph

```text
/build-feature (orchestrator)
├── research (opus)
│   └── visual-explainer → research.html
│
├── plan (opus)
│   ├── architect (opus) → design review
│   ├── frontend-patterns / api-design (loaded if detected)
│   └── visual-explainer → plan.html
│
└── implement (sonnet)
    ├── tdd-guide (sonnet) → TDD execution
    ├── code-reviewer (sonnet) → OWASP + quality review
    ├── refactor-cleaner (sonnet) → dead code removal
    ├── database-reviewer (sonnet) → conditional DB review
    ├── doc-updater (sonnet) → conditional doc updates
    └── visual-explainer → plan.html, diff-review.html

Rules (6 files) loaded as always-on context in every session.
Agents read a subset relevant to their role.
```

## Repository Structure

```text
.
├── skills/           8 workflow skills (build-feature, research, plan, implement, ...)
├── commands/         13 slash commands (/diff-review, /fact-check, ...)
├── agents/           7 sub-agents (architect, tdd-guide, code-reviewer, ...)
├── rules/            6 always-on rules (coding-style, testing, security, ...)
├── claude/           Claude Code config (settings.json, hooks.json, statusline.sh)
├── opencode/         OpenCode config (opencode.jsonc auto-generated, tui.json)
├── config/           Shared config (opencode-only.json)
├── scripts/          Tooling (sync-permissions.py, test-pipeline.sh, hooks/)
├── docs/claude/      Feature artifacts (research, plans, visuals)
├── .githooks/        Pre-commit hook (runs tests + sync)
├── .builds/          CI (sr.ht → GitHub mirror)
└── install.sh        Symlink installer
```

## Components

### Skills

| Name | Model | Role |
|------|-------|------|
| `build-feature` | — | Orchestrator: coordinates research → plan → implement |
| `research` | opus | Deep-read codebase area, produce detailed research document |
| `plan` | opus | Create implementation plan, refine through annotation cycles |
| `implement` | sonnet | Execute approved plan with TDD and multi-agent verification |
| `refactor` | sonnet | Code restructuring with incremental test verification |
| `visual-explainer` | — | Generate self-contained HTML pages for visual explanations |
| `frontend-patterns` | — | Reference patterns for component composition, state, a11y |
| `api-design` | — | Reference patterns for REST API design |

### Commands

| Command | Description |
|---------|-------------|
| `/build-feature` | Full feature workflow — research, plan with annotations, implement |
| `/research` | Deep-read a codebase area, produce research document |
| `/plan` | Create implementation plan with annotation cycles |
| `/implement` | Execute an approved plan, track progress |
| `/diff-review` | Visual HTML diff review — before/after architecture comparison |
| `/fact-check` | Verify document accuracy against codebase, correct in place |
| `/generate-architecture-diagram` | Visual HTML module topology and data flows |
| `/generate-visual-plan` | Visual HTML plan with state machines and code snippets |
| `/generate-slides` | Magazine-quality slide deck as self-contained HTML |
| `/generate-web-diagram` | Standalone HTML diagram, opened in browser |
| `/plan-review` | Visual HTML: current state vs. proposed implementation |
| `/project-recap` | Visual HTML: rebuild mental model of project state |
| `/model-route` | Recommend optimal Claude model for a task |

### Agents

| Name | Model | Role | Rules Read |
|------|-------|------|------------|
| `architect` | opus | System design, trade-offs, architecture review | coding-style, performance, security |
| `tdd-guide` | sonnet | Red-green-refactor TDD execution | testing, coding-style |
| `code-reviewer` | sonnet | OWASP Top 10 + quality review (>80% confidence) | coding-style, testing, security, performance |
| `refactor-cleaner` | sonnet | Dead code detection and safe removal | coding-style |
| `database-reviewer` | sonnet | Query optimization, schema, DB security | security, performance |
| `doc-updater` | sonnet | Keep documentation in sync with code | git-workflow |
| `refactorer` | sonnet | Structural transforms preserving behavior | coding-style, performance, security, testing |

### Rules

| Rule | Scope |
|------|-------|
| `coding-style` | Immutability, file size limits, naming conventions |
| `testing` | TDD, behavior testing, no shared state |
| `security` | No secrets in code, input validation, parameterized queries |
| `performance` | Model routing, profiling before optimizing, caching |
| `git-workflow` | Commit format, branching, docs/claude/ artifact handling |
| `development-workflow` | Plan first, TDD, review, then commit |

## Dual-Tool Support

This repository serves two AI coding tools with different config formats:

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Config location | `~/.claude/` | `~/.config/opencode/` |
| Skills | `~/.claude/skills/` (symlinked) | Same location |
| Commands | `~/.claude/commands/` (symlinked) | `~/.config/opencode/commands/` (symlinked) |
| Agents | `~/.claude/agents/` (symlinked) | Not supported |
| Rules | `~/.claude/rules/` (symlinked) | Not supported |
| Permissions format | `"Bash(echo *)"` in JSON arrays | `"echo *": "allow"` in JSONC objects |
| Permission source of truth | `claude/settings.json` | Auto-generated via `sync-permissions.py` |
| Hooks | `claude/hooks.json` (cost tracker) | Not supported |

`claude/settings.json` is always edited directly. The sync script automatically generates OpenCode's config — never edit `opencode/opencode.jsonc` by hand.

## Installation Details

`install.sh` symlinks everything into the right locations:

1. **Skills** → `~/.claude/skills/` (shared by both tools)
2. **Rules** → `~/.claude/rules/`
3. **Commands for Claude Code** → `~/.claude/commands/`, skipping commands that have a matching skill directory (avoids duplicate slash commands)
4. **Commands for OpenCode** → `~/.config/opencode/commands/` (all commands installed)
5. **Agents** → `~/.claude/agents/`
6. **Claude Code config** → `settings.json`, `statusline.sh`, `hooks.json` symlinked to `~/.claude/`
7. **Git hooks** → `core.hooksPath` set to `.githooks`
8. **Permission sync** → runs `sync-permissions.py`
9. **OpenCode config** → `opencode.jsonc`, `tui.json` symlinked to `~/.config/opencode/`

The command/skill duality means that commands sharing a name with a skill (e.g., `build-feature`, `research`, `plan`, `implement`, `refactor`) are skipped for Claude Code (where skills take precedence) but installed for OpenCode (which reads all commands).

## Infrastructure

### Permission Sync

`scripts/sync-permissions.py` bridges Claude Code and OpenCode permissions:

1. Reads `claude/settings.json` (source of truth)
2. Parses Claude's `Tool(pattern)` format (e.g., `Bash(echo *)`)
3. Maps tools to OpenCode equivalents (Bash→bash, Read→read, Write→write, Edit→edit, WebFetch→webfetch, WebSearch→websearch)
4. Skips Claude-specific tools with no OpenCode equivalent (Search, Glob, Grep, Task)
5. Merges with `config/opencode-only.json` for OpenCode-specific entries
6. Writes combined result to `opencode/opencode.jsonc`

Runs automatically on every commit via `.githooks/pre-commit` and during `install.sh`.

### Test Pipeline

`scripts/test-pipeline.sh` validates the repository's internal consistency:

- **Frontmatter**: Skills need name/description, agents need name/description/tools, commands need description
- **Phase content**: Research skill must mention "Deep-read", plan must mention "Todo List", etc.
- **Cross-references**: Agent files referenced from skills must exist
- **Agent rule dependencies**: Rule files referenced in agent bodies must exist
- **Symlink targets**: All files that `install.sh` would symlink must exist
- **Guide/skill sync**: HTML guide files must reference same agents and commands as SKILL.md
- **Stale stubs**: Short files with redirect language are flagged

`scripts/test-pipeline-self-test.sh` is a meta-test that creates intentionally broken files to verify the test pipeline catches each error class.

### CI

`.builds/mirror.yml` — sr.ht CI mirrors the repository to GitHub on push.

## License

MIT — see [LICENSE](LICENSE).
