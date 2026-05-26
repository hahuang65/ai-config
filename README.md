# ai-config

Centralized configuration for AI coding assistants — Claude Code and OpenCode.

## Quick Start

```sh
git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

## The /build Workflow

The centerpiece of this repository is `/build` — a disciplined 4-phase workflow for building software features with AI assistance. It enforces a "think before you code" discipline:

1. **Grill** the idea against the project's domain language (interactive Q&A; updates `CONTEXT.md` and ADRs inline)
2. **Draft a PRD** synthesizing the grilling outcome (user stories + decisions, no code snippets)
3. **Break it into tasks** as vertical-slice tracer bullets (each slice cuts through every layer end-to-end)
4. **Implement** via vertical-slice TDD — AI does it, or AI coaches you through it one test at a time

The pipeline merges Boris Tane's research-first discipline with Matt Pocock's skills-TDD workflow (`grill-with-docs → to-prd → to-issues → tdd`), adapted to keep all artifacts local, annotatable, and paired with visual HTML companions.

### Pipeline Overview

```text
/build "feature"
  ├── Phase 1: /grill        → ./CONTEXT.md  (glossary)
  │                            ./docs/adr/    (ADRs — hard-to-reverse decisions)
  │
  ├── Phase 2: /prd          → docs/claude/<slug>/prd.md + prd.html
  │                            (annotation cycles via // comments)
  │
  ├── Phase 3: /tasks        → docs/claude/<slug>/tasks.md + tasks.html
  │                            (vertical-slice tracer bullets, HITL/AFK)
  │                            optional: --publish → real GitHub Issues
  │
  └── Phase 4: /implement         → AI writes test → AI writes impl → repeat
        or    /implement-coach    → AI writes test → YOU write impl → AI verifies → repeat
                                    (final: diff-review.html)
```

`CONTEXT.md` and `docs/adr/` live at the repo root and accrete across many `/build` runs. Per-feature artifacts (PRD, tasks, diff review) live in `docs/claude/<YYYYMMDD-HHMM>-<slug>/`.

### Phase 1: Grill

**Entry**: `/build [description]` or `/grill [topic]`

1. Reads existing `CONTEXT.md` (or `CONTEXT-MAP.md` for multi-context repos) and `docs/adr/`
2. Interviews the user **one question at a time**, recommending an answer for each
3. Challenges new ideas against the existing glossary; flags terminology collisions
4. Sharpens fuzzy language ("you said 'account' — Customer or User?")
5. Stress-tests with concrete scenarios; cross-references with code
6. **Updates `CONTEXT.md` inline** as terms get resolved — no batching
7. **Offers ADRs sparingly** — only when hard-to-reverse, surprising, and the result of a real trade-off
8. **STOPS — waits for user to say "draft the PRD"**

If a question can be answered by exploring the codebase, grill does so instead of asking.

### Phase 2: PRD

**Entry**: User says "draft the PRD" or `/prd [description]`

1. Reads `CONTEXT.md`, recent ADRs, and any prior session context
2. **Does NOT re-interview** — grilling was the design phase; this transcribes its outcome
3. Sketches major modules (deep-modules philosophy) and checks them with the user
4. Writes `prd.md`
   - Sections: Problem Statement, Solution, User Stories (extensive numbered list), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes
   - **No code snippets, no file paths** (they go stale; PRD is durable)
5. Generates `prd.html` via visual-explainer (companion to `prd.md`)
6. **STOPS — waits for user review**
7. **Annotation cycle**: user adds `//` comments → agent addresses every note → updates `prd.md` → removes annotations → regenerates `prd.html`
8. Repeats until user explicitly approves the PRD

### Phase 3: Tasks

**Entry**: User says "break it into tasks" or `/tasks [prd-dir] [--publish]`

1. Reads the approved `prd.md`, `CONTEXT.md`, and relevant ADRs
2. Drafts **vertical-slice tracer bullets** — each slice cuts through every layer end-to-end (schema, API, UI, tests) and is demoable on its own
3. Marks each slice **HITL** (human-in-the-loop) or **AFK** (away-from-keyboard); prefers AFK
4. Writes `tasks.md` with dependency order (blockers first) and generates `tasks.html`
5. **Quizzes the user**: granularity? dependency relationships? HITL/AFK split? coverage of user stories?
6. Iterates until approved
7. **Optional `--publish`**: creates real GitHub Issues via `gh issue create`, in dependency order, and back-fills issue numbers into `tasks.md`

### Phase 4: Implement (vertical-slice TDD)

**Entry**: User says "implement" or `/implement [tasks-dir]` or `/implement-coach [tasks-dir]`

Both modes follow the same TDD philosophy: **vertical, never horizontal. One test → one implementation → repeat.** Tests written in batches upfront test *imagined* behavior, not *actual* behavior; this pattern is explicitly rejected.

**Good tests** describe behavior through public interfaces; they survive refactors. **Bad tests** couple to implementation details, mock internal collaborators, or test private methods.

#### AI Mode (`/implement`)

1. Reads `tasks.md` and works one slice at a time, in dependency order
2. For each slice: confirms interface → RED→GREEN per acceptance criterion → refactor when GREEN → mark complete
3. Marks each slice `**Status:** ✅ Complete` in `tasks.md`
4. Runs continuous type checks and linters
5. **Verification loop**: type check → lint → test suite → build (repeat until all pass)
6. Runs **`database-reviewer` agent** if DB code was touched
7. Runs `/simplify` for reuse opportunities
8. Runs **`refactor-cleaner` agent** for dead code removal
9. Runs **`code-reviewer` agent** — OWASP Top 10, confidence >80% threshold
10. Runs **`doc-updater` agent** if APIs/architecture changed
11. Runs `/fact-check` on both `prd.md` and `tasks.md`
12. **Refreshes `prd.html` and `tasks.html`** — mandatory regeneration to mirror finals
13. **Generates `diff-review.html`** via visual-explainer, then runs `/fact-check` on it
14. **NEVER commits** — leaves that to the user

#### Coach Mode (`/implement-coach`)

1. For each slice: AI confirms interface → AI writes ONE failing test → **user implements** → AI verifies → next test
2. AI **never** writes implementation code during the coaching loop — the user does
3. AI never queues up multiple tests in advance — only the test you're currently solving exists
4. Refactor together when GREEN (never while RED), re-running tests after each step
5. Final verification loop (same as AI mode)
6. Post-completion cleanup is AI-driven; code-review findings are surfaced to the user to fix
7. **NEVER commits** — leaves that to the user

### Annotation Cycles

The PRD phase uses inline `//` annotations for user feedback:

```markdown
## User Stories

// also need: "as an admin, I want to revoke sessions"
1. As a customer, I want to see my balance...

// remove this — it's out of scope per the grill session
7. As a customer, I want to export to CSV...
```

The agent addresses every annotation, updates the document, removes the `//` comments, and regenerates the visual companion. The tasks phase uses a lighter quiz-the-user pattern (present numbered list of slices, iterate).

### Visual Sync Guarantee

Visual HTML companions must always mirror their markdown counterparts. Regeneration is mandatory:

- **PRD phase**: after every annotation cycle — even if the user approves. One final regeneration on approval.
- **Tasks phase**: after every iteration of the quiz cycle
- **Implement phase**: after implementation completes — mandatory regardless of whether the markdown changed

### Artifact Lifecycle

| Artifact | Location | Lifetime |
|---|---|---|
| `CONTEXT.md` | repo root | Long-lived — accretes across all features |
| `docs/adr/*.md` | repo root | Long-lived — historical record |
| `docs/claude/<slug>/` | per-feature | Optional — keep, delete, or `.gitignore` |

The git-workflow rule recommends committing `CONTEXT.md` and `docs/adr/` always, and committing per-feature directories alongside the feature they describe.

### Legacy Example

The [`example/`](example/) directory contains sample artifacts from a previous version of the pipeline (research → plan → implement). It's preserved as a stylistic reference for the annotation cycle and visual companions, but the new pipeline produces `prd.md` and `tasks.md` instead of `research.md` and `plan.md`. See [example/README.md](example/README.md) for a side-by-side note.

## Skill / Rule / Agent Graph

```text
/build (orchestrator)
├── grill (opus)
│   ├── CONTEXT.md     ← repo root
│   └── docs/adr/      ← repo root
│
├── prd (opus)
│   ├── architect (opus, conditional) → design review
│   ├── frontend-patterns / api-design (loaded if detected)
│   └── visual-explainer → prd.html
│
├── tasks (opus)
│   ├── visual-explainer → tasks.html
│   └── gh issue create (optional, --publish)
│
├── implement (sonnet)
│   ├── tdd-guide (sonnet) → vertical-slice TDD
│   ├── code-reviewer (sonnet) → OWASP + quality review
│   ├── refactor-cleaner (sonnet) → dead code removal
│   ├── database-reviewer (sonnet) → conditional DB review
│   ├── doc-updater (sonnet) → conditional doc updates
│   └── visual-explainer → prd.html, tasks.html, diff-review.html
│
└── implement-coach (sonnet)
    ├── AI writes ONE test at a time (no batching)
    ├── User implements; AI verifies
    ├── Refactor together when GREEN
    └── visual-explainer → prd.html, tasks.html, diff-review.html

Rules (6 files) loaded as always-on context in every session.
Agents read a subset relevant to their role.
```

## Repository Structure

```text
.
├── skills/           9 workflow skills (build, grill, prd, tasks, implement, implement-coach, ...)
├── commands/         14 slash commands (/diff-review, /fact-check, /implement-coach, ...)
├── agents/           7 sub-agents (architect, tdd-guide, code-reviewer, ...)
├── rules/            6 always-on rules (coding-style, testing, security, ...)
├── claude/           Claude Code config (settings.json, hooks.json, statusline.sh)
├── opencode/         OpenCode config (opencode.jsonc auto-generated, tui.json)
├── config/           Shared config (opencode-only.json)
├── scripts/          Tooling (sync-permissions.py, test-pipeline.sh, hooks/)
├── docs/claude/      Per-feature artifacts (PRDs, tasks, visuals)
├── example/          Legacy example artifacts (old research/plan pipeline)
├── .githooks/        Pre-commit hook (runs tests + sync)
├── .builds/          CI (sr.ht → GitHub mirror)
└── install.sh        Symlink installer
```

## Components

### Skills

| Name | Model | Role |
|------|-------|------|
| `build` | — | Orchestrator: coordinates grill → prd → tasks → implement |
| `grill` | opus | Interview-driven domain modeling; updates `CONTEXT.md` + ADRs inline |
| `prd` | opus | Synthesize a PRD from grilling outcome; user-stories + decisions, no code |
| `tasks` | opus | Break PRD into vertical-slice tracer bullets; optional GitHub publish |
| `implement` | sonnet | Execute approved tasks via vertical-slice TDD + multi-agent verification |
| `implement-coach` | sonnet | Coach user through implementation; AI writes ONE test at a time |
| `refactor` | sonnet | User-directed restructuring with incremental test verification |
| `visual-explainer` | — | Generate self-contained HTML pages for visual explanations |
| `frontend-patterns` | — | Reference patterns for component composition, state, a11y |
| `api-design` | — | Reference patterns for REST API design |

### Commands

| Command | Description |
|---------|-------------|
| `/build` | Full feature workflow — grill, PRD, tasks, implement |
| `/grill` | Interactive domain-modeling session (updates `CONTEXT.md` + ADRs) |
| `/prd` | Synthesize a PRD from current conversation; annotation cycles |
| `/tasks` | Break a PRD into vertical-slice tasks; `--publish` for GitHub Issues |
| `/implement` | Execute approved tasks via vertical-slice TDD (AI implements) |
| `/implement-coach` | Coach-guided implementation (AI writes one test, you write the code) |
| `/diff-review` | Visual HTML diff review — before/after architecture comparison |
| `/fact-check` | Verify document accuracy against codebase, correct in place |
| `/generate-architecture-diagram` | Visual HTML module topology and data flows |
| `/generate-visual-plan` | Visual HTML companion for PRDs and task breakdowns |
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

The command/skill duality means that commands sharing a name with a skill (`build`, `grill`, `prd`, `tasks`, `implement`, `implement-coach`, `refactor`) are skipped for Claude Code (where skills take precedence) but installed for OpenCode (which reads all commands).

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
- **Phase content**: Grill skill must mention `CONTEXT.md`, PRD must mention "User Stories", tasks must mention "vertical slice", implement must mention vertical-slice TDD, etc.
- **Cross-references**: Agent files referenced from skills must exist
- **Agent rule dependencies**: Rule files referenced in agent bodies must exist
- **Symlink targets**: All files that `install.sh` would symlink must exist
- **Guide/skill sync**: HTML guide files must reference same agents and commands as SKILL.md
- **Stale stubs**: Short files with redirect language are flagged

`scripts/test-pipeline-self-test.sh` is a meta-test that creates intentionally broken files to verify the test pipeline catches each error class.

### CI

`.builds/mirror.yml` — sr.ht CI mirrors the repository to GitHub on push.

## Acknowledgements

This project stands on the shoulders of others:

- **[Boris Tane's Claude Code workflow](https://boristane.com/blog/how-i-use-claude-code/)** — The annotation-cycle discipline, the "think before you code" guardrails, and the markdown-as-shared-state philosophy at the heart of `/build` originate from Boris's research → plan → implement method. This project's first pipeline was a direct port of his approach.
- **[Matt Pocock's skills-TDD pipeline](https://www.aihero.dev/skills-tdd)** — The current pipeline (`grill-with-docs → to-prd → to-issues → tdd`) and Matt's stance on vertical-slice TDD ("write one test, one implementation, repeat — batched tests describe imagined behavior, not actual behavior") drive the design of `/grill`, `/prd`, `/tasks`, and the vertical-slice rewrites of `/implement` and `/implement-coach`. The format files (CONTEXT-FORMAT.md, ADR-FORMAT.md) are taken from his [skills repo](https://github.com/mattpocock/skills).
- **[nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer)** — The `visual-explainer` skill is taken wholesale from this repository, with only minor modifications. All the HTML visual generation (PRD, tasks, diff-review, architecture diagrams, slides, etc.) is powered by this work.
- **[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)** — The rules and agent definitions in this repo are borrowed and adapted from this collection. The coding-style, testing, security, and performance rules, as well as the agent configurations (architect, tdd-guide, code-reviewer, etc.), draw heavily from this source.

## License

MIT — see [LICENSE](LICENSE).
