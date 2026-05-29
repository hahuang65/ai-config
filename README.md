# ai-config

Centralized configuration for AI coding harnesses — Claude Code, OpenCode, and omp. Skills, commands, agents, and rules authored once, installed into all three by `install.sh`.

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

The pipeline merges Boris Tane's research-first discipline with Matt Pocock's skills-TDD workflow (`grill-with-docs → to-prd → to-issues → tdd`), adapted to keep all artifacts local, annotatable, and paired with visual HTML companions. All four phases work identically in Claude Code, OpenCode, and omp — the skills are harness-agnostic and discovered from the same source files in each harness's root.

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

The `git-commit` rule covers what to include: `CONTEXT.md` and `docs/adr/` ship with the commits they relate to, and per-feature `docs/claude/` directories ship alongside their feature. See the rule for the `~/Projects/a5/**` exception that keeps these artifacts local in repos teammates haven't opted into.

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

Rules (11 files — 3 rulebook + 8 TTSR) + Hooks (5 omp-only TS modules — 4 pre + 1 post). In Claude Code rules auto-load as global instructions every turn; in omp the 3 rulebook rules load on demand via `rule://<name>`, the 8 TTSR rules fire mid-stream on regex match, and the 5 hooks (per ADR-0006) fire on the actual `tool_call` / `tool_result` events with structured input parsing for patterns where regex had known bypasses.
Agents read a subset relevant to their role.
```

## Repository Structure

```text
.
├── skills/           13 workflow skills (build, grill, prd, tasks, implement, implement-coach, ...)
├── commands/         18 slash commands (/diff-review, /fact-check, /implement-coach, ...)
├── agents/           7 sub-agents (architect, tdd-guide, code-reviewer, ...)
├── rules/            11 rules (3 advisory rulebook + 8 TTSR enforcement)
├── claude/           Claude Code config (settings.json, hooks.json, statusline.sh)
├── opencode/         OpenCode config (opencode.jsonc auto-generated, tui.json)
├── omp/              omp config (config.yml hand-authored) + extensions/ + hooks/{pre,post}/
├── omp/hooks/        5 omp hooks — 4 pre-tool blockers + 1 post-tool secret redactor (per ADR-0006)
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

#### Core `/build` pipeline

| Name | Model | Role |
|------|-------|------|
| `build` | — | Orchestrator: coordinates grill → prd → tasks → implement |
| `grill` | opus | Interview-driven domain modeling; updates `CONTEXT.md` + ADRs inline |
| `prd` | opus | Synthesize a PRD from grilling outcome; user-stories + decisions, no code |
| `tasks` | opus | Break PRD into vertical-slice tracer bullets; optional GitHub publish |
| `implement` | sonnet | Execute approved tasks via vertical-slice TDD + multi-agent verification |
| `implement-coach` | sonnet | Coach user through implementation; AI writes ONE test at a time |

#### Standalone tools that pair with `/build`

| Name | Model | Role |
|------|-------|------|
| `refactor` | sonnet | User-directed restructuring (extract, inline, split, rename) with incremental test verification |
| `improve-codebase` | opus | Survey an area for deepening opportunities (shallow → deep modules) and propose them as an HTML report |
| `prototype` | sonnet | Throwaway prototype to flesh out a design — terminal TUI for logic, or N UI variants on one route |
| `handoff` | sonnet | Compact the current conversation into a handoff doc in the OS temp dir for another session |

#### Reference / utility

| Name | Model | Role |
|------|-------|------|
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
| `/improve-codebase` | Survey an area for deepening opportunities; HTML report + grilling loop |
| `/prototype` | Throwaway prototype (logic TUI or UI variants) to flesh out a design |
| `/handoff` | Write a handoff doc to OS temp dir for another agent session |
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
| `doc-updater` | sonnet | Keep documentation in sync with code | git-commit |
| `refactorer` | sonnet | Structural transforms preserving behavior | coding-style, performance, security, testing |

### Rules

Rules split into two buckets per [ADR-0003](docs/adr/0003-ttsr-for-omp-runtime-enforcement.md). In Claude Code all rules auto-load as global instructions; in omp the **rulebook** rules are listed for on-demand loading via `rule://<name>` and the **TTSR** rules fire mid-stream on regex match.

#### Rulebook (advisory — loaded on demand in omp)

| Rule | Scope |
|------|-------|
| `coding-style` | Immutability, file size limits, naming conventions, nesting, magic numbers |
| `testing` | TDD, behavior testing, no shared state, shared setup |
| `performance` | Model routing, profiling before optimizing, caching, timeouts |
| `git-commit` | Commit message format (`@~/.gitmessage`), branching, staging policy, `~/Projects/a5/**` staging exception |

#### TTSR (enforcement — regex-triggered mid-stream in omp)

| Rule | Triggers on |
|------|-------------|
| `security` | Hardcoded secrets, string-concat SQL, user-input → file APIs, `eval`, shell injection |
| `no-git-destructive` | Force-push, `--no-verify`, `--no-gpg-sign`, `--amend --no-edit`, broad `reset --hard`, `clean -f` |
| `no-cloud-destroy` | AWS `delete-*` / `terminate-*`, Terraform `apply` / `destroy`, gcloud delete, `kubectl delete` |
| `no-shell-write` | File writes via shell redirection (`echo >`, `cat >`, `tee`) — forces use of Write/Edit tools |
| `no-deploy` | `make deploy/apply/push`, `npm/yarn/pnpm run deploy`, `cap … deploy`, `fly deploy`, `vercel --prod`, `wrangler deploy`, `serverless deploy`, `kubectl apply`, `helm install/upgrade` |
| `no-db-mutation` | `psql/mysql/mariadb/sqlite3/mongosh/redis-cli` with DROP/TRUNCATE/ALTER TABLE/DELETE FROM/UPDATE SET, or `.sql` file fed into the CLI |
| `no-dd-disk` | `dd` with `of=/dev/...` or `if=/dev/...` (raw disk overwrite/read) |
| `no-broad-chmod` | `chmod -R` against `/`, `~`, `$HOME`, `/etc`, `/usr`, `/var`, `/opt`, `/Users`, `/home`, or `*` |

#### Hooks (omp-only — `omp/hooks/{pre,post}/*.ts`, per [ADR-0006](docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md))

Four pre-tool blockers + one post-tool secret redactor. Migrated from TTSR rules whose regex had known bypasses; structured `event.input` parsing catches what the regex couldn't (process substitution, find-exec, interpreter wrappers).

| Hook | Replaces / role | What it does |
|------|-----------------|--------------|
| `pre/guard-rm.ts` | replaces `no-rm-rf-root.md` | Blocks broad `rm -rf` + `find / -delete` + process-substitution wrappers |
| `pre/guard-curl-pipe.ts` | replaces `no-curl-pipe-interpreter.md` | Blocks `curl/wget` piped to interpreters, including tee-interposer and `bash <(curl URL)` |
| `pre/guard-credentials.ts` | replaces `no-credentials-read.md` | Blocks credential file reads via `read`, `edit`, or `bash` tools (8 credential path patterns, 19 credential-reader commands) |
| `pre/guard-sudo.ts` | replaces `no-sudo.md` | Blocks any `sudo` invocation in bash commands |
| `post/redact-keys.ts` | net-new (TTSR can't mutate output) | Redacts secrets in `read` / `bash` output (API keys, tokens, AWS access keys, GitHub tokens, JWTs, HTTP Bearer) with placeholder skip |

## Triple-Harness Support

This repository serves three AI coding harnesses with different runtime models. `install.sh` mirrors every shared primitive into every harness root (per [ADR-0001](docs/adr/0001-full-mirror-per-harness.md)) — same source files, three sets of symlinks:

| Aspect | Claude Code | OpenCode | omp |
|--------|-------------|----------|-----|
| Config root | `~/.claude/` | `~/.config/opencode/` | `~/.omp/agent/` |
| Skills | `~/.claude/skills/` (symlinked) | `~/.config/opencode/` discovers same | `~/.omp/agent/skills/` (symlinked) |
| Commands | `~/.claude/commands/` (symlinked, dedup against skills) | `~/.config/opencode/commands/` (all symlinked) | `~/.omp/agent/commands/` (all symlinked) |
| Agents | `~/.claude/agents/` (symlinked) | Not supported | `~/.omp/agent/agents/` (symlinked) |
| Rules | `~/.claude/rules/` (symlinked) | Not supported | `~/.omp/agent/rules/` (symlinked) |
| Rule semantics | Auto-loaded as global instructions every turn | n/a | **Rulebook** (loaded on demand via `rule://`) + **TTSR** (regex-triggered mid-stream) |
| Permissions format | `"Bash(echo *)"` in JSON arrays | `"echo *": "allow"` in JSONC objects | `tools.approvalMode: write` tiers + `tools.approval.<tool>` overrides in YAML |
| Per-pattern bash allowlist | Yes (~80 entries) | Yes (auto-synced from Claude) | **No** — TTSR rules fill this gap |
| Permission source of truth | `claude/settings.json` | Auto-generated via `sync-permissions.py` | Hand-authored `omp/config.yml` |
| Hooks | `claude/hooks.json` + `deny-curl-to-interpreter.sh` shell hook | Not supported | 5 TS modules in `omp/hooks/` (4 pre-tool blockers + 1 post-tool secret redactor, see [ADR-0006](docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md)) |

`claude/settings.json` is always edited directly; the sync script automatically generates `opencode/opencode.jsonc`. `omp/config.yml` is **decoupled** — Claude's per-pattern allowlist has no omp equivalent, so the sync script is deliberately a Claude ↔ OpenCode bridge only (per [ADR-0004](docs/adr/0004-omp-permissions-and-hooks-decoupled.md)). TTSR rules in `rules/` are omp's per-pattern enforcement layer.

## Installation Details

`install.sh` symlinks everything into the right locations:

1. **Skills** → `~/.claude/skills/` (Claude + OpenCode share this dir)
2. **Rules** → `~/.claude/rules/`
3. **Commands for Claude Code** → `~/.claude/commands/`, skipping commands that have a matching skill directory (avoids duplicate slash commands)
4. **Commands for OpenCode** → `~/.config/opencode/commands/` (all commands installed)
5. **Agents** → `~/.claude/agents/`
6. **Claude Code config** → `settings.json`, `statusline.sh`, `hooks.json` symlinked to `~/.claude/`
7. **Git hooks** → `core.hooksPath` set to `.githooks`
8. **Permission sync** → runs `sync-permissions.py` (Claude ↔ OpenCode only)
9. **OpenCode config** → `opencode.jsonc`, `tui.json` symlinked to `~/.config/opencode/`
10. **omp** → `omp/config.yml` symlinked to `~/.omp/agent/config.yml`, plus `skills/`, `commands/`, `agents/`, `rules/` symlinked into `~/.omp/agent/` (all commands installed — the Claude duality skip-rule does not apply)

The command/skill duality means that commands sharing a name with a skill (`build`, `grill`, `prd`, `tasks`, `implement`, `implement-coach`, `refactor`) are skipped for Claude Code (where skills take precedence) but installed for OpenCode and omp (which read all commands).

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
- **[Matt Pocock's skills-TDD pipeline](https://www.aihero.dev/skills-tdd)** and the broader [skills repo](https://github.com/mattpocock/skills) — the core pipeline (`grill-with-docs → to-prd → to-issues → tdd`) and Matt's stance on vertical-slice TDD ("write one test, one implementation, repeat — batched tests describe imagined behavior, not actual behavior") drive the design of `/grill`, `/prd`, `/tasks`, and the vertical-slice rewrites of `/implement` and `/implement-coach`. The standalone tools `/handoff` ([article](https://www.aihero.dev/skills-handoff)), `/prototype`, and `/improve-codebase` (renamed from `improve-codebase-architecture`) are also ports of Matt's skills, with internal references rewritten to match this repo's naming. The format files (CONTEXT-FORMAT.md, ADR-FORMAT.md) and the LANGUAGE/DEEPENING/HTML-REPORT/INTERFACE-DESIGN supporting docs are taken directly from his repo.
- **[nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer)** — The `visual-explainer` skill is taken wholesale from this repository, with only minor modifications. All the HTML visual generation (PRD, tasks, diff-review, architecture diagrams, slides, etc.) is powered by this work.
- **[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)** — The rules and agent definitions in this repo are borrowed and adapted from this collection. The coding-style, testing, security, and performance rules, as well as the agent configurations (architect, tdd-guide, code-reviewer, etc.), draw heavily from this source.
- **[can1357/oh-my-pi (omp)](https://github.com/can1357/oh-my-pi)** ([docs](https://omp.sh/docs)) — The third harness this repo configures. The **TTSR** (time-traveling stream rules) concept — mid-stream regex-triggered rule injection with stream-abort + retry — is omp's contribution to the cross-harness rule shape and is what makes `rules/security.md` and the seven narrow `no-*.md` rules into enforcement rather than advisory content. The YAML-based extension / hook / skill model omp uses informed how this repo's per-harness boundaries got drawn (see [ADR-0004](docs/adr/0004-omp-permissions-and-hooks-decoupled.md) and [ADR-0005](docs/adr/0005-flat-shared-config-no-per-harness-scoping.md)).

## License

MIT — see [LICENSE](LICENSE).
