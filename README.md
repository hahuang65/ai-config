# ai-config

Centralized configuration for Claude Code and pi. Skills, commands, agents, and rules are authored once and installed into each harness by `install.sh`.

> **Editing or adding skills / commands / agents / rules?** Read [`AGENTS.md`](AGENTS.md) — the authoring contract: progressive disclosure, the per-primitive harness matrix (what each is and which harnesses consume it), and how advisory rules differ from guardrails (enforced once in the shared guard core). `make test` is the pre-commit gate that enforces it (run `make` to list targets).

## Quick Start

```sh
git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

## The /build Workflow

The centerpiece of this repository is `/build` — a disciplined 5-phase workflow for building software features with AI assistance. It enforces a "think before you code" discipline:

1. **Grill** the idea against the project's domain language (interactive Q&A; updates `CONTEXT.md` and ADRs inline)
2. **Draft a spec** synthesizing the grilling outcome (user stories + decisions, no code snippets)
3. **Break it into tasks** as vertical-slice tracer bullets (each slice cuts through every layer end-to-end)
4. **Implement** via vertical-slice TDD — AI does it, or AI coaches you through it one test at a time
5. **Review the changes** architecturally — deepening opportunities in what was just built; the report is where you decide to commit or iterate

The pipeline merges Boris Tane's research-first discipline with Matt Pocock's skills-TDD workflow (`grill-with-docs → to-prd → to-issues → tdd`), adapted to keep all artifacts local, annotatable, and paired with visual HTML companions. Both implementation modes and all five phases are harness-neutral across Claude Code and pi; each harness discovers the same source skills through its config root.

### Pipeline Overview

```text
/build "feature"
  ├── Phase 1: /grill        → ./CONTEXT.md  (glossary)
  │                            ./docs/adr/    (ADRs — hard-to-reverse decisions)
  │
  ├── Phase 2: /spec          → docs/features/<slug>/specs.md + specs.html
  │                            (annotation cycles via // comments)
  │
  ├── Phase 3: /todo        → docs/features/<slug>/tasks.md + tasks.html
  │                            (vertical-slice tracer bullets, HITL/AFK)
  │
  ├── Phase 4: /code         → AI writes test → AI writes impl → repeat
  │     or    /coach    → AI writes test → YOU write impl → AI verifies → repeat
  │                                 (diff-review.html)
  │
  └── Phase 5: /review-code       → architecture-reviewer agent on ONLY the changes
                                    → HTML report → user commits or iterates
```

`CONTEXT.md` and `docs/adr/` live at the repo root and accrete across many `/build` runs. Per-feature artifacts (spec, tasks, diff review) live in `docs/features/<YYYYMMDD-HHMM>-<slug>/`.

### Phase 1: Grill

**Entry**: `/build [description]` or `/grill [topic]`

1. Reads existing `CONTEXT.md` (or `CONTEXT-MAP.md` for multi-context repos) and `docs/adr/`
2. Interviews the user **one question at a time**, recommending an answer for each
3. Challenges new ideas against the existing glossary; flags terminology collisions
4. Sharpens fuzzy language ("you said 'account' — Customer or User?")
5. Stress-tests with concrete scenarios; cross-references with code
6. **Updates `CONTEXT.md` inline** as terms get resolved — no batching
7. **Offers ADRs sparingly** — only when hard-to-reverse, surprising, and the result of a real trade-off
8. **STOPS — waits for user to say "draft the spec"**

If a question can be answered by exploring the codebase, grill does so instead of asking.

### Phase 2: Spec

**Entry**: User says "draft the spec" or `/spec [description]`

1. Reads `CONTEXT.md`, recent ADRs, and any prior session context
2. **Does NOT re-interview** — grilling was the design phase; this transcribes its outcome
3. Sketches major modules (deep-modules philosophy) and checks them with the user
4. Writes `specs.md`
   - Sections: Problem Statement, Solution, User Stories (extensive numbered list), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes
   - **No code snippets, no file paths** (they go stale; spec is durable)
5. Generates `specs.html` via visualize (companion to `specs.md`)
6. **STOPS — waits for user review**
7. **Annotation cycle**: user adds `//` comments → agent addresses every note → updates `specs.md` → removes annotations → regenerates `specs.html`
8. Repeats until user explicitly approves the spec

### Phase 3: Tasks

**Entry**: User says "break it into tasks" or `/todo [spec-dir]`

1. Reads the approved `specs.md`, `CONTEXT.md`, and relevant ADRs
2. Drafts **vertical-slice tracer bullets** — each slice cuts through every layer end-to-end (schema, API, UI, tests) and is demoable on its own
3. Marks each slice **HITL** (human-in-the-loop) or **AFK** (away-from-keyboard); prefers AFK
4. Writes `tasks.md` (dependency order, blockers first), generates `tasks.html`, and opens it in the browser
5. **Reviews with the user** (asks directly, or accepts `//` annotations on `tasks.md`): granularity? dependency relationships? HITL/AFK split? coverage of user stories?
6. Iterates on feedback — the markdown is the source of truth; no per-pass visual regeneration
7. On the user's confirmation, regenerates `tasks.html` once if it changed, then advances to implementation

### Phase 4: Implement (vertical-slice TDD)

**Entry**: User says "implement" or `/code [tasks-dir]` or `/coach [tasks-dir]`

Both modes follow the same TDD philosophy: **vertical, never horizontal. One test → one implementation → repeat.** Tests written in batches upfront test *imagined* behavior, not *actual* behavior; this pattern is explicitly rejected.

**Good tests** describe behavior through public interfaces; they survive refactors. **Bad tests** couple to implementation details, mock internal collaborators, or test private methods.

#### AI Mode (`/code`)

1. Reads `tasks.md` and works one slice at a time, in dependency order
2. For each slice: confirms interface → RED→GREEN per acceptance criterion → refactor when GREEN → mark complete
3. Marks each slice `**Status:** ✅ Complete` in `tasks.md`
4. Runs continuous type checks and linters
5. **Verification loop**: type check → lint → test suite → build (repeat until all pass)
6. Runs **`database-reviewer` agent** if DB code was touched
7. Runs the **`refactorer` agent in hygiene mode** — dead code, unused imports & dependencies, duplication, simplification (SAFE applied, CAREFUL/RISKY reported)
8. Runs **`code-reviewer` agent** — OWASP Top 10, confidence >80% threshold
9. Runs **`doc-updater` agent** if APIs/architecture changed
10. Runs the **`fact-checker` agent** on both `specs.md` and `tasks.md` — independent, cold-context verification
11. **Refreshes `specs.html` and `tasks.html`** — mandatory regeneration to mirror finals
12. **Generates `diff-review.html`** via visualize, then runs the `fact-checker` agent on it
13. **NEVER commits** — leaves that to the user

#### Coach Mode (`/coach`)

1. For each slice: AI confirms interface → AI writes ONE failing test → **user implements** → AI verifies → next test
2. AI **never** writes implementation code during the coaching loop — the user does
3. AI never queues up multiple tests in advance — only the test you're currently solving exists
4. Refactor together when GREEN (never while RED), re-running tests after each step
5. Final verification loop (same as AI mode)
6. Post-completion cleanup is AI-driven; code-review findings are surfaced to the user to fix
7. **NEVER commits** — leaves that to the user

### Annotation Cycles

The spec phase uses inline `//` annotations for user feedback:

```markdown
## User Stories

// also need: "as an admin, I want to revoke sessions"
1. As a customer, I want to see my balance...

// remove this — it's out of scope per the grill session
7. As a customer, I want to export to CSV...
```

The agent addresses every annotation, updates the document, removes the `//` comments, and re-presents — working from the markdown during the review. The tasks phase defaults to direct questioning (present a numbered list of slices, ask, iterate); both phases also accept `//` annotations. The visual companion is generated and opened when the markdown is first written, left untouched during the review, then regenerated once at the end only if the markdown changed.

### Visual Sync Guarantee

Visual HTML companions are generated and opened when the markdown is first written, and regenerated:

- **Spec phase**: once after the review, only if the markdown changed — never mid-review
- **Tasks phase**: once after the review, only if the markdown changed — never mid-review
- **Implement phase**: after implementation completes — mandatory regardless of whether the markdown changed

### Artifact Lifecycle

| Artifact | Location | Lifetime |
|---|---|---|
| `CONTEXT.md` | repo root | Long-lived — accretes across all features |
| `docs/adr/*.md` | repo root | Long-lived — historical record |
| `docs/features/<slug>/` | per-feature | Optional — keep, delete, or `.gitignore` |

The `git-commit` rule covers what to include: `CONTEXT.md` and `docs/adr/` ship with the commits they relate to, and per-feature `docs/features/` directories ship alongside their feature. See the rule for the `~/Projects/a5/**` exception that keeps these artifacts local in repos teammates haven't opted into.

### Legacy Example

The [`example/`](example/) directory contains sample artifacts from a previous version of the pipeline (research → plan → implement). It's preserved as a stylistic reference for the annotation cycle and visual companions, but the new pipeline produces `specs.md` and `tasks.md` instead of `research.md` and `plan.md`. See [example/README.md](example/README.md) for a side-by-side note.

## Skill / Rule / Agent Graph

```text
/build (orchestrator)
├── grill (opus)
│   ├── CONTEXT.md     ← repo root
│   └── docs/adr/      ← repo root
│
├── specs (opus)
│   ├── architect (opus, conditional) → design review
│   ├── api-designer / frontend-architect (sonnet, conditional) → domain consult
│   └── visualize → specs.html
│
├── tasks (opus)
│   └── visualize → tasks.html
│
├── implement (sonnet)
│   ├── tdd-guide (sonnet) → vertical-slice TDD
│   ├── code-reviewer (sonnet) → OWASP + quality review
│   ├── refactorer (sonnet) → hygiene sweep: dead code, duplication
│   ├── database-reviewer (sonnet) → conditional DB review
│   ├── doc-updater (sonnet) → conditional doc updates
│   └── visualize → specs.html, tasks.html, diff-review.html
│
└── coach (sonnet)
    ├── AI writes ONE test at a time (no batching)
    ├── User implements; AI verifies
    ├── Refactor together when GREEN
    └── visualize → specs.html, tasks.html, diff-review.html

Rules (6 advisory files) load on demand in every harness. Claude Code and pi read the common `~/.dotfiles/ai/rules/` sources directly and always load only the small `harness-system-prompt.md` bootstrap containing critical constraints, the shared location, and load triggers. All *enforcement* lives in the shared guard core (per ADR-0012), not in rules — see Guardrails below.
Agents read a subset relevant to their role.
```

## Repository Structure

```text
.
├── skills/           17 workflow skills (build, grill, specs, tasks, implement, coach, ...)
├── commands/         13 slash commands (/visualize-diff, /coach, /pickup, ...)
├── agents/           7 sub-agents (architect, tdd-guide, code-reviewer, ...)
├── harness-system-prompt.md  Small always-on critical baseline + rule routing
├── rules/            6 on-demand advisory rules (all enforcement is in shared/)
├── harnesses/        Pluggable per-harness modules, each with a manifest.sh (ADR-0010)
│   ├── claude/         Claude Code module (settings.json, hooks.json, statusline.sh, hooks/guard.ts)
│   └── pi/             pi module (settings.json, extensions/) — @earendil-works/pi-coding-agent
├── shared/           guard core — policy-registry.ts (IDs + floor flags), guard-core.ts (detection, written once), conformance.ts
├── test/             bun tests — adapter + conformance behavior
├── Makefile          Developer tasks — run `make` for the menu
├── scripts/          Validation pipeline + self-test (test-pipeline*.sh)
├── docs/features/      Per-feature artifacts (specs, tasks, visuals)
├── example/          Legacy example artifacts (old research/plan pipeline)
├── .githooks/        Pre-commit hook (runs `make test`)
├── .builds/          CI (sr.ht → GitHub mirror)
└── install.sh        Symlink installer
```

## Components

### Skills

> Model tiers in the skill tables are **recommendations, not enforced per-phase routing.** A skill runs in whatever model the session is using. Only **agents** pin a model via `model:` frontmatter, so the Agents table's tiers are enforced. Pick the suggested tier manually, or set your harness default accordingly.

#### Core `/build` pipeline

| Name | Model (rec.) | Role |
|------|-------|------|
| `build` | — | Orchestrator: coordinates grill → specs → tasks → implement |
| `grill` | opus | Interview-driven domain modeling; updates `CONTEXT.md` + ADRs inline |
| `spec` | opus | Synthesize a spec from grilling outcome; user-stories + decisions, no code |
| `todo` | opus | Break spec into vertical-slice tracer bullets; optional GitHub publish |
| `code` | sonnet | Execute approved tasks via vertical-slice TDD + multi-agent verification |
| `coach` | sonnet | Coach user through implementation; AI writes ONE test at a time |

#### Standalone tools that pair with `/build`

| Name | Model (rec.) | Role |
|------|-------|------|
| `refactor` | sonnet | User-directed restructuring (extract, inline, split, rename) with incremental test verification |
| `review-code` | opus | Architectural review via the `architecture-reviewer` agent — /build Phase 5 (ONLY the changes) or standalone (entire codebase, or the area in arguments) |
| `prototype` | sonnet | Throwaway prototype to flesh out a design — terminal TUI for logic, or N UI variants on one route |
| `handoff` | sonnet | Summarise the current session into a disposable handoff doc in the OS temp dir for another session |
| `pickup` | sonnet | Resume work from a handoff doc — most recent by default, or one matched from an argument |

#### Reference / utility

| Name | Model (rec.) | Role |
|------|-------|------|
| `visualize` | — | Generate self-contained HTML pages for visual explanations |
| `visualize-diff` | — | Visual HTML diff review — before/after comparison + code-review analysis (also runs in `/code`'s review chain) |

### Commands

| Command | Description |
|---------|-------------|
| `/build` | Full feature workflow — grill, spec, tasks, implement |
| `/grill` | Interactive domain-modeling session (updates `CONTEXT.md` + ADRs) |
| `/spec` | Synthesize a spec from current conversation; annotation cycles |
| `/todo` | Break a spec into vertical-slice tasks (reviewed locally) |
| `/code` | Execute approved tasks via vertical-slice TDD (AI implements) |
| `/coach` | Coach-guided implementation (AI writes one test, you write the code) |
| `/review-code` | Architectural review — no args: entire codebase; args: that area; HTML report + grilling loop |
| `/prototype` | Throwaway prototype (logic TUI or UI variants) to flesh out a design |
| `/handoff` | Write a handoff doc to OS temp dir for another agent session |
| `/pickup` | Resume from a handoff doc (most recent by default, or matched from an argument) |
| `/visualize-diff` | Visual HTML diff review — before/after architecture comparison |

### Agents

| Name | Model | Role | Rules Read |
|------|-------|------|------------|
| `architect` | opus | System design, trade-offs, architecture review | coding-style, performance, security |
| `architecture-reviewer` | opus | Discovery engine for `/review-code` — walks a scope, returns deepening candidates (deletion test, depth/seams/locality) | coding-style, performance |
| `api-designer` | sonnet | REST endpoint contracts: resources, status codes, pagination, versioning — consulted by `/spec` when a feature touches the API | coding-style, security, performance |
| `frontend-architect` | sonnet | Component boundaries, state ownership, data fetching, a11y baseline — consulted by `/spec` when a feature touches UI | coding-style, performance, security |
| `tdd-guide` | sonnet | Red-green-refactor TDD execution | testing, coding-style |
| `code-reviewer` | sonnet | OWASP Top 10 + quality review (>80% confidence) | coding-style, testing, security, performance |
| `database-reviewer` | sonnet | Query optimization, schema, DB security | security, performance |
| `doc-updater` | sonnet | Keep documentation in sync with code | git-commit |
| `fact-checker` | sonnet | Independent verification of specs/tasks/HTML docs against code and git history — corrects drift in place (review-chain step; our own, not Claude's built-in `/fact-check`) | git-commit |
| `refactorer` | sonnet | The engine for behavior-preserving change: plan mode (approved transformation plans) + hygiene mode (dead code, unused deps, duplication — the review chain's Refactor step) | coding-style, performance, security, testing |

### Rules

`rules/` is **advisory guidance only** (per [ADR-0012](docs/adr/0012-consolidate-enforcement-retire-ttsr.md)) — no rule blocks anything; all enforcement lives in the guard core (below). Detailed rules load on demand in every harness. Claude and pi receive the small always-on [`harness-system-prompt.md`](harness-system-prompt.md) bootstrap, which provides critical constraints, rule locations, and load triggers without injecting all rule content ([ADR-0016](docs/adr/0016-small-always-on-bootstrap-lazy-rulebooks.md)). No rule carries `condition:`/`scope:` — the retired TTSR frontmatter; the gate rejects any that does.

| Rule | Scope |
|------|-------|
| `coding-style` | Immutability, file size limits, naming, nesting, magic numbers |
| `testing` | TDD, behavior testing, no shared state, shared setup |
| `performance` | Profiling before optimizing, caching, pagination, timeouts |
| `git-commit` | Commit format (`@~/.gitmessage`) and staging policy |
| `mise` | Toolchain managed by mise; ignore other version managers |
| `security` | Security anti-patterns that are *guidance* (string-concat SQL, `eval`, `exec`-concat, input→file API) + always-on input/output/authz/logging rules. The hard-blockable part (hardcoded secret literals) is the `no-hardcoded-secret` guardrail. |

#### Guardrails — shared policy core + per-harness adapters ([ADR-0011](docs/adr/0011-guardrail-policies-ports-and-adapters.md), [ADR-0012](docs/adr/0012-consolidate-enforcement-retire-ttsr.md))

Security guardrails are defined **once** and projected into each harness (ports-and-adapters). A canonical registry (`shared/policy-registry.ts`) lists each guardrail by ID with a `floor` flag; the detection logic lives once in `shared/guard-core.ts` (inspecting `command`, `path`, and write `content`); each harness wires it in via a thin adapter sized to its enforcement tier. ADR-0012 finished the consolidation — every command/content enforcement policy lives here, so it enforces uniformly across harnesses.

| Policy | Floor | What it blocks |
|--------|:-----:|----------------|
| `no-secret-access` | ✓ | Credential file reads via path or bash readers (incl. substitution) |
| `no-hardcoded-secret` | ✓ | Writing a secret literal (known key formats: `sk-…`, `AKIA…`, PEM, GitHub tokens) into a file |
| `no-curl-pipe-shell` | ✓ | curl/wget piped or process-substituted into an interpreter |
| `no-broad-rm` | ✓ | `rm -rf` / `find … -delete` against broad targets (`/`, `~`, `$HOME`, `*`) |
| `no-sudo` | ✓ | Any `sudo` invocation |
| `no-cloud-destroy` | ✓ | aws `delete-*`/`terminate-*`, terraform `apply`/`destroy`, gcloud delete, kubectl delete |
| `no-db-mutation` | ✓ | DROP/TRUNCATE/DELETE/UPDATE via a DB CLI, or a `.sql` piped in |
| `no-dd-disk` | ✓ | `dd` with `of=/dev/…` or `if=/dev/…` |
| `no-broad-chmod` | ✓ | `chmod -R` against a broad system/home target (`/`, `~`, `$HOME`, `/etc`, …, `*`) |
| `no-git-destructive` | ✓ | force-push, `--no-verify`/`--no-gpg-sign`, `reset --hard`, `clean -f`, amend-in-place |
| `no-deploy` | ✓ | make/npm/fly/vercel/wrangler/helm/`kubectl apply` deploys |
| `no-shell-write` | — | File writes via shell redirection (`echo >`, `cat >`, `tee`) — the lone non-floor (conformance discriminator) |

- **pi (tier A)** runs the core through an auto-discovered extension: `harnesses/pi/extensions/guard-policies.ts`. pi has no built-in permission system, so this extension is its entire policy layer.
- **Claude Code (tier B)** runs the same core through a stdin/stdout shim: `harnesses/claude/hooks/guard.ts` (registered in `settings.json`); its static `permissions.deny` denylist remains as defense-in-depth.
- A **conformance test** asserts every harness enforces every floor policy (emits a coverage matrix; no silent gaps) — run via `make test/guard`. An **isolation test** forbids cross-harness pollution — run via `make test/install`. `make test` runs both (plus the guard-core/adapter unit tests).

## Multi-Harness Support

This repository serves two AI coding harnesses with different runtime models. `install.sh` projects the same curated primitives into each harness using native paths where required. Claude and pi share a small always-on bootstrap, read detailed rules directly from the canonical source, and route guardrails through harness-specific adapters.

| Aspect | Claude Code | pi |
|--------|-------------|----|
| Config root | `~/.claude/` | `~/.pi/agent/` |
| Skills | `~/.claude/skills/` (symlinked) | `~/.pi/agent/skills/` (symlinked) |
| Commands | `~/.claude/commands/` (symlinked, dedup against skills) | Not supported; pi uses skills and prompt templates |
| Agents | `~/.claude/agents/` (symlinked) | `~/.pi/agent/agents/` (symlinked) |
| Rules | `~/.dotfiles/ai/rules/` (canonical source) | `~/.dotfiles/ai/rules/` (canonical source) |
| Guardrail adapter | Tier B command-hook shim + static denylist | Tier A in-process extension |

Cross-harness guardrails live once in `shared/` and project into both harnesses through their adapters. The conformance test enforces the mandatory policy floor everywhere.

## Installation Details

`install.sh` is a **generic loop over harness modules** (`harnesses/*/manifest.sh`, per [ADR-0010](docs/adr/0010-modular-harness-modules-and-isolation.md)) — adding a harness is dropping in a module, removing one is deleting its directory. For each module it:

1. Reads the module's `manifest.sh` (its `config_root`, the shared categories it consumes, and an `install_module` hook).
2. **Mirrors each module's consumed shared set** into its config root. Skills and agents reach both harnesses; commands reach Claude; rules remain at their canonical source path.
3. **Installs module files and global instructions** via each manifest (Claude: `CLAUDE.md`, `settings.json`, `statusline.sh`, `hooks.json`; pi: `AGENTS.md`, settings, extensions).
4. **Prunes dangling links** so the install self-heals after a rename/delete.
5. Skips any `harness_pending` modules.

Finally it sets `core.hooksPath` to `.githooks`. The guard core in `shared/` is resolved by the adapters via symlink realpath, so it is not separately mirrored.

Commands sharing a name with a skill (`build`, `grill`, `spec`, `todo`, `code`, `coach`, `refactor`) are skipped for Claude Code because skills take precedence.

## Infrastructure

### Test Pipeline

`make test` runs every check across four categories — `test/content`,
`test/install`, `test/guard`, `test/meta` (run `make` to list them; `VERBOSE=1`
shows every individual check). The `test/content` + `test/install` categories
(`scripts/test-pipeline.sh`) validate the repository's internal consistency:

- **Frontmatter**: Skills need name/description, agents need name/description/tools, commands need description
- **Phase content**: Grill skill must mention `CONTEXT.md`, spec must mention "User Stories", tasks must mention "vertical slice", implement must mention vertical-slice TDD, etc.
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
- **[Matt Pocock's skills-TDD pipeline](https://www.aihero.dev/skills-tdd)** and the broader [skills repo](https://github.com/mattpocock/skills) — the core pipeline (`grill-with-docs → to-prd → to-issues → tdd`) and Matt's stance on vertical-slice TDD ("write one test, one implementation, repeat — batched tests describe imagined behavior, not actual behavior") drive the design of `/grill`, `/spec`, `/todo`, and the vertical-slice rewrites of `/code` and `/coach`. The standalone tools `/handoff` ([article](https://www.aihero.dev/skills-handoff)), `/prototype`, and `/review-code` (renamed from `improve-codebase-architecture`) are also ports of Matt's skills, with internal references rewritten to match this repo's naming. The format files (CONTEXT-FORMAT.md, ADR-FORMAT.md) and the LANGUAGE/DEEPENING/HTML-REPORT/INTERFACE-DESIGN supporting docs are taken directly from his repo.
- **[nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer)** — The `visualize` skill (renamed from `visual-explainer`) is taken wholesale from this repository, with only minor modifications. All the HTML visual generation (spec, tasks, diff-review, architecture diagrams, slides, etc.) is powered by this work.
- **[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)** — The rules and agent definitions in this repo are borrowed and adapted from this collection. The coding-style, testing, security, and performance rules, as well as the agent configurations (architect, tdd-guide, code-reviewer, etc.), draw heavily from this source.
- **[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)** — Its TTSR and hook models informed the guardrail architecture before the harness was retired by [ADR-0017](docs/adr/0017-retire-oh-my-pi.md).
- **[pi (badlogic/earendil-works)](https://pi.dev)** — The second harness this repo configures (`@earendil-works/pi-coding-agent`, config root `~/.pi/agent`). Its `tool_call` extension routes the shared guard core, while its global `AGENTS.md` carries only the small shared bootstrap and detailed rules remain on demand ([ADR-0016](docs/adr/0016-small-always-on-bootstrap-lazy-rulebooks.md)).

## License

MIT — see [LICENSE](LICENSE).
