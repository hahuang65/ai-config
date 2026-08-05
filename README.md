# ai-config

Centralized configuration for Claude Code and pi. Skills, commands, agents, and rules are authored once and installed into each harness by `install.sh`.

> **Editing or adding commands / skills / agents / rules?** Read [`AGENTS.md`](AGENTS.md) — the authoring contract: progressive disclosure, the per-primitive harness matrix (what each is and which harnesses consume it), and how advisory rules differ from guardrails (enforced once in the shared guard core). `make test` is the pre-commit gate that enforces it (run `make` to list targets).

## Quick Start

```sh
git clone <repo> ~/.dotfiles/ai
cd ~/.dotfiles/ai
./install.sh
```

## The /build Workflow

The centerpiece of this repository is `/build` — a disciplined 5-phase workflow for building software features with AI assistance. It enforces a "think before you code" discipline:

1. **Grill** the idea in dependency-aware rounds and invoke `model-domain` to sharpen the project's **ubiquitous language**: the shared canonical vocabulary used by domain experts, users, documentation, tests, and code.
2. **Draft a spec** synthesizing the grilling outcome (user stories + decisions, no code snippets)
3. **Break it into tasks** as vertical-slice tracer bullets (each slice cuts through every layer end-to-end)
4. **Implement** via vertical-slice TDD — AI does it, or AI coaches you through it one test at a time
5. **Review the change** against approved intent — adversarial review, targeted evidence, documentation, lint, and an explicit Review-to-done decision

The pipeline merges Boris Tane's research-first discipline with Matt Pocock's skills-TDD workflow (`grill-with-docs → to-prd → to-issues → tdd`), adapted around canonical local HTML review artifacts.
The `review-artifact` skill adds element and text annotations, durable feedback polling, live reload, severe layout warnings, and explicit approval.
Both implementation modes and all five phases are harness-neutral across Claude Code and pi.

### Pipeline Overview

```text
/build "feature"
  ├── Phase 1: /grill        → ./CONTEXT.md  (glossary)
  │                            ./docs/adr/    (ADRs — hard-to-reverse decisions)
  │
  ├── Phase 2: /spec          → docs/features/<slug>/specs.html
  │                            (canonical HTML reviewed via review-artifact)
  │
  ├── Phase 3: /todo        → docs/features/<slug>/tasks.html
  │                            (canonical vertical slices, HITL/AFK)
  │
  ├── Phase 4: /code         → AI writes test → AI writes impl → repeat
  │     or    /coach         → AI writes test → YOU write impl → AI verifies → repeat
  │                            → full verification + hygiene
  │
  └── Phase 5: /review-change → adversarial review → evidence → docs → lint
                                → review-artifact → approve as-is or fix selected
```

`CONTEXT.md` and `docs/adr/` live at the repo root and accrete across many `/build` runs. Canonical per-feature `specs.html` and `tasks.html` live in `docs/features/<YYYYMMDD-HHMM>-<slug>/`; the final Review change report is disposable and lives in the operating-system temp directory.

### Standalone Review Change CLI

`./install.sh` links `review-change` into `~/.local/bin/` so the same validation gate can run without entering an agent session.
The executable resolves the source pull request or freezes a source branch or base/head range before cloning, snapshots tracked and untracked state into a disposable isolated clone, launches one foreground `pi` process as its AI backend, and remains read-only for every target.

```sh
review-change
review-change --intent "Preserve the public API while adding cache invalidation"
review-change feature/cache-invalidation --intent "Review this branch read-only"
review-change main...HEAD --intent "Review this historical range read-only"
review-change 123 --intent "Validate the pull request against its stated intent"
review-change main...HEAD --provider openai --model gpt-5 --thinking high
```

With no target, the CLI resolves the current branch pull request or branch point against the source repository before isolation, then reviews that frozen scope from the isolated snapshot.
One explicit target may be a local or remote branch name, local Git range, GitHub pull-request URL, or pull-request number, and every mode remains read-only.
Review-owned clones and worktrees live under `~/.review-orchard/`, separate from development worktrees under `~/.orchard/`.
Provider, model, and thinking overrides pass directly to `pi` as argument-array values rather than through a shell; the selected model also reaches mandatory Review change subagents.
In a sufficiently wide TTY, the CLI displays a color-coded left-right view: the pipeline occupies the left pane and the selected stage log occupies the right pane; narrow terminals retain the stacked layout.
Stage states and log outcomes use distinct terminal colors, with `NO_COLOR` support for monochrome output.
Each pipeline stage lists its purpose and recorded sub-stages vertically beneath it with a live or completed elapsed timer beside every sub-stage, shortening left-pane sub-stage labels to at most six words while retaining the bounded original telemetry text in the navigable, credential-redacted right-pane log alongside observable lifecycle actions, commands, durations, and outcomes.
Collected Findings, missing evidence, documentation issues, and similar results appear as one concise line per item beneath their sub-stage; successful completion text is not repeated in the sidebar.
The header keeps the isolated review worktree path, immutable scope, risk, and open Findings visible.
Resolve target and Create isolation use concise pipeline outcomes rather than repeating the GitHub URL, workspace path, report path, or untracked-file details already available in the header and selected-stage log.
Cleanup reports only `Removed` because the header already identifies the review worktree.
The parent validates ordered stage telemetry, shows each active sub-stage as the current operational intent, retains prior sub-stages as `STEP` log entries, owns cancellation through final Summary dismissal, restores terminal state after interruption, and uses plain status lines when output is redirected.
Vim-style `j`/`k` navigates stages, Ctrl-D/Ctrl-U scrolls the selected log, Enter expands or collapses lines, `f` resumes following the active stage, and Ctrl-C aborts an active run; no single-character key aborts or closes the review.
After validation, it opens the disposable HTML report in a new Firefox window on macOS (or the platform HTML viewer elsewhere) without waiting for browser closure and includes a copyable general review comment plus separately copyable inline Finding comments inside pull-request reports, with exact locations, a severity/action legend, inset copy icons, and persistent copied-state styling.
After cleanup, an interactive run renders the parent and assistant Markdown through non-interactive Glow when available, forces color when terminal color is enabled, selects a final Summary stage within the existing pipeline/log layout rather than replacing it with a full-screen summary, and rerenders it when terminal width changes.
Glow failure or a Summary pane narrower than 20 columns falls back to the built-in renderer, Ctrl-U and Ctrl-D scroll the final log, and Ctrl-C exits once the review is no longer running; `q`, `x`, and Escape do not dismiss it.
Redirected output prints the same summary normally.
Standalone Review change does not invoke `review-artifact`, poll for feedback, or require approval.
A disabled push URL plus the CLI-specific pi guard protect the original checkout and block structured writes, common direct mutation, staging, commits, pushes, and provider mutations.
Structured writes are allowed only inside a dedicated report directory whose resolved path is validated not to overlap the source checkout or clone.

### Phase 1: Grill

**Entry**: `/build [description]` or `/grill [topic]`

1. Loads `model-domain`, existing `CONTEXT.md` files (through `CONTEXT-MAP.md` when present), and applicable ADRs.
2. Interviews the user in dependency-aware rounds, asking the whole ready decision frontier and recommending an answer for each question.
3. Uses `model-domain` to challenge terminology collisions, sharpen fuzzy language, stress-test scenarios, and cross-reference with code.
4. **Updates `CONTEXT.md` inline** as terms resolve and uses the resulting ubiquitous language consistently.
5. **Offers ADRs sparingly** — only when hard-to-reverse, surprising, and the result of a real trade-off.
6. **STOPS — waits for user confirmation before drafting the spec.**

If a question can be answered by exploring the codebase, grill does so instead of asking.

### Standalone Domain Modeling

**Entry**: `/model-domain [build|augment|audit] [scope-or-topic]`

- **Build from scratch** bootstraps context files in an existing project that has none.
- **Augment** adds missing concepts or sharpens a named area in an existing model.
- **Audit and condense** finds bloat, ambiguity, duplication, drift, and misplaced terms across `CONTEXT.md` or files mapped by `CONTEXT-MAP.md`.

The session investigates facts from code, documentation, and ADRs, then asks the user only for domain decisions.
It updates resolved terms inline and preserves the distinction between the ubiquitous language and the glossary that records it.

### Phase 2: Spec

**Entry**: User says "draft the spec" or `/spec [description]`

1. Reads `CONTEXT.md`, recent ADRs, and any prior session context
2. **Does NOT re-interview** — grilling was the design phase; this transcribes its outcome
3. Sketches major modules (deep-modules philosophy) and checks them with the user
4. Writes canonical semantic `specs.html`
   - Sections: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes
   - **No code snippets or file paths** because they go stale
5. Opens `specs.html` through `review-artifact`
6. Applies every browser annotation or message to the same HTML and lets the session live-reload it
7. Repeats until the user emits explicit approval; ending or closing review is not approval

### Phase 3: Tasks

**Entry**: User says "break it into tasks" or `/todo [spec-dir]`

1. Reads approved canonical `specs.html`, `CONTEXT.md`, and relevant ADRs
2. Drafts **vertical-slice tracer bullets** that cut through every layer and remain independently demoable
3. Marks each slice **HITL** or **AFK** and prefers AFK
4. Writes canonical `tasks.html` with stable slice, status, dependency, story, test-surface, and acceptance-criterion metadata
5. Opens it through `review-artifact` and asks about granularity, dependencies, HITL/AFK, and story coverage
6. Applies each feedback batch to the same live-reloading HTML
7. Advances only on explicit approval or the chat fallback

### Phase 4: Implement (vertical-slice TDD)

**Entry**: User says "implement" or `/code [tasks-dir]` or `/coach [tasks-dir]`

Both modes follow the same TDD philosophy: **vertical, never horizontal. One test → one implementation → repeat.** Tests written in batches upfront test *imagined* behavior, not *actual* behavior; this pattern is explicitly rejected.

**Good tests** describe behavior through public interfaces; they survive refactors. **Bad tests** couple to implementation details, mock internal collaborators, or test private methods.

#### AI Mode (`/code`)

1. Reads canonical `tasks.html` and works one slice at a time in dependency order
2. For each slice: confirms interface → RED→GREEN per acceptance criterion → refactor when GREEN → mark complete
3. Updates visible status and `data-status="complete"` for each criterion and slice in `tasks.html`
4. Runs continuous type checks and linters
5. **Verification loop**: type check → lint → test suite → build (repeat until all pass)
6. Runs the **`refactorer` agent in hygiene mode** — dead code, unused imports and dependencies, duplication, simplification (SAFE applied, CAREFUL/RISKY reported)
7. Reports every final verification command, scope, and outcome
8. Proceeds directly to Phase 5 Review change, which owns adversarial review, conditional database Findings, targeted evidence, documentation, lint, canonical-artifact fact-checking, and the final decision report
9. **NEVER commits** — leaves that to the user

#### Coach Mode (`/coach`)

1. For each slice: AI confirms interface → AI writes ONE failing test → **user implements** → AI verifies → next test
2. AI **never** writes implementation code during the coaching loop — the user does
3. AI never queues up multiple tests in advance — only the test you're currently solving exists
4. Refactor together when GREEN (never while RED), re-running tests after each step
5. Final verification loop (same as AI mode)
6. Post-completion hygiene applies SAFE mechanical cleanup and reports higher-risk candidates
7. Review change preserves user ownership of source and test fixes while handling selected documentation and formatting repairs mechanically
8. **NEVER commits** — leaves that to the user

### Review Artifact Loop

When an HTML artifact asks for feedback, a decision, or approval, `review-artifact` serves it in a sandboxed local browser shell.
The user can annotate an exact rendered element or selected text, queue several notes with a freeform message, and send one coherent batch.
The foreground agent poll returns those targets with a compact DOM snapshot.
A per-daemon capability protects agent-only event consumption, serialized startup gives concurrent callers the winning capability, and shared validation rejects malformed durable HTTP, frame, queue, and chat data before persistence or rendering.
The versioned health handshake replaces incompatible daemon code before reuse while preserving durable session state.
The agent edits the same canonical HTML, the open browser live-reloads it, and the sandboxed bridge restores scroll through bounded messages before polling resumes with an agent reply.

Only the browser's explicit **Approve** action clears a gate.
**End review**, browser close, disconnect, or poll interruption never implies approval.
If browser review cannot start, the phase uses chat while preserving the same approval semantics.

### Artifact Lifecycle

| Artifact | Location | Lifetime |
|---|---|---|
| `CONTEXT.md`, or `CONTEXT-MAP.md` plus mapped context files | repo root and mapped contexts | Long-lived — accretes across all features |
| `docs/adr/*.md` | repo root | Long-lived — historical record |
| `docs/features/<slug>/` | per-feature | Optional — keep, delete, or `.gitignore` |

The `git-commit` rule covers what to include: `CONTEXT.md` and `docs/adr/` ship with the commits they relate to, and per-feature `docs/features/` directories ship alongside their feature. See the rule for the A5 project exception that keeps these artifacts local in repositories where teammates have not opted in.

### Legacy Example

The [`example/`](example/) directory contains historical artifacts from the earlier grill → PRD → tasks → implementation-with-diff-review pipeline.
It remains a stylistic reference only; current runs produce canonical `specs.html` and `tasks.html` and end with Review change.

## Skill / Rule / Agent Graph

```text
/build (orchestrator)
├── grill
│   └── model-domain
│       ├── CONTEXT.md / CONTEXT-MAP.md
│       └── docs/adr/
│
├── spec
│   ├── api-designer / frontend-architect (conditional) → domain consult
│   └── review-artifact → canonical specs.html feedback + approval
│
├── todo
│   └── review-artifact → canonical tasks.html feedback + approval
│
├── code / coach
│   ├── tdd-guide → vertical-slice TDD
│   └── refactorer → hygiene sweep
│
└── review-change
    ├── change-reviewer → independent adversarial review
    ├── change-fixer → selected objective repairs
    ├── database-reviewer (conditional) → read-only specialist Findings
    ├── fact-checker → canonical HTML drift correction
    └── review-artifact → interactive final gate

Rules (6 advisory files) load on demand in every harness. Claude Code and pi read the common `~/.dotfiles/ai/rules/` sources directly and always load only the small `harness-system-prompt.md` bootstrap containing critical constraints, the shared location, and load triggers. All *enforcement* lives in the shared guard core (per ADR-0012), not in rules — see Guardrails below.
Agents read a subset relevant to their role.
```

## Repository Structure

```text
.
├── commands/         Shared explicit aliases and compositions (deliver, rebase, resolve-conflicts)
├── skills/           Shared discoverable workflow capabilities (review-change, review-artifact, ...)
├── agents/           Shared specialist agents (change-reviewer, tdd-guide, refactorer, ...)
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

### Commands

Commands and skills have no same-name overlap.
A command is either a thin alias to a differently named skill or a composition of multiple skills.
`rebase` aliases `orchard`.
`resolve-conflicts` aliases the `resolve-conflicts` skill for an in-progress Git operation.
`deliver` routes managed worktrees through Orchard and ordinary branches directly through Git.
Managed delivery invokes the commit skill only when Orchard reports `needs-commit`; ordinary delivery commits when needed, then rebases and fast-forwards local trunk or opens the trusted A5 pull-request form.
Orchard keeps managed cleanup operation IDs internal while human fallback uses `orchard deliver --finalize <intent>`.
Claude installs commands under `~/.claude/commands/`; pi installs the same Markdown under `~/.pi/agent/prompts/`.

### Skills

> Model tiers in the skill tables are **recommendations, not enforced per-phase routing.**
> Skills and agents use the harness default unless the invoking CLI supplies an override.
> Pick a suggested tier manually, or set your harness default accordingly.

#### Core `/build` pipeline

| Name | Model (rec.) | Role |
|------|-------|------|
| `build` | — | Orchestrator: coordinates grill → spec → todo → code/coach → review-change |
| `grill` | opus | Dependency-aware feature interview; invokes model-domain during Phase 1 |
| `model-domain` | opus | Build, augment, or audit the ubiquitous language in context files; record qualifying ADRs |
| `spec` | opus | Synthesize canonical specs.html and review it through review-artifact |
| `todo` | opus | Break the approved spec into canonical HTML vertical slices |
| `code` | sonnet | Execute approved tasks via vertical-slice TDD + multi-agent verification |
| `coach` | sonnet | Coach user through implementation; AI writes ONE test at a time |
| `review-change` | opus | Validate a feature change, branch, local Git range, or GitHub pull request against Authoritative intent; also installed as a standalone pi-backed executable |

#### Standalone tools that pair with `/build`

| Name | Model (rec.) | Role |
|------|-------|------|
| `refactor` | sonnet | User-directed restructuring (extract, inline, split, rename) with incremental test verification |
| `review-code` | opus | Optional standalone architectural exploration — entire codebase or named area |
| `prototype` | sonnet | Throwaway prototype to flesh out a design — terminal TUI for logic, or N UI variants on one route |
| `handoff` | sonnet | Summarise the current session into a disposable handoff doc in the OS temp dir for another session |
| `pickup` | sonnet | Resume work from a handoff doc — most recent by default, or one matched from an argument |

#### Reference / utility

| Name | Model (rec.) | Role |
|------|-------|------|
| `review-artifact` | — | Review local HTML with exact annotations, durable polling, live reload, layout warnings, and explicit approval |
| `orchard` | — | Delegate reusable worktree lifecycle and policy-aware delivery to the independently installed Git-owned CLI and native harness transitions |
| `commit` | — | Create one focused checkout-local commit without integration or lifecycle changes |
| `resolve-conflicts` | — | Resolve compatible conflict hunks, including saved working-state restoration, and collect human decisions for incompatible hunks |
| `visualize` | — | Generate self-contained HTML pages for visual explanations |
| `visualize-diff` | — | Visual HTML diff review — before/after comparison + code-review analysis |

### Agents

Every agent uses the harness default unless the invoking CLI supplies an override.

| Name | Role | Rules Read |
|------|------|------------|
| `architecture-reviewer` | Discovery engine for `/review-code` — walks a scope, returns deepening candidates (deletion test, depth/seams/locality) | coding-style, performance |
| `api-designer` | REST endpoint contracts: resources, status codes, pagination, versioning — consulted by `/spec` when a feature touches the API | coding-style, security, performance |
| `frontend-architect` | Component boundaries, state ownership, data fetching, a11y baseline — consulted by `/spec` when a feature touches UI | coding-style, performance, security |
| `tdd-guide` | Red-green-refactor TDD execution | testing, coding-style |
| `change-reviewer` | Read-only full-change adversarial review with structured Findings and intent coverage | coding-style, testing, security, performance |
| `change-fixer` | Selected repairs within mode ownership with focused verification | coding-style, testing, security, performance |
| `database-reviewer` | Read-only database specialist Findings for Review change | coding-style, testing, security, performance |
| `fact-checker` | Independent verification of canonical HTML artifacts and other codebase claims — corrects drift in place | git-commit |
| `refactorer` | Behavior-preserving directed refactors plus post-implementation hygiene | coding-style, performance, security, testing |

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
| Skills | `~/.claude/skills/` (registered as `/<name>`) | `~/.pi/agent/skills/` (registered as `/skill:<name>`) |
| Commands | `~/.claude/commands/` (registered as `/<name>`) | `~/.pi/agent/prompts/` (registered as `/<name>`) |
| Agents | `~/.claude/agents/` (symlinked) | `~/.pi/agent/agents/` (symlinked) |
| Rules | `~/.dotfiles/ai/rules/` (canonical source) | `~/.dotfiles/ai/rules/` (canonical source) |
| Guardrail adapter | Tier B command-hook shim + static denylist | Tier A in-process extension |

Cross-harness guardrails live once in `shared/` and project into both harnesses through their adapters.
The conformance test enforces the mandatory policy floor everywhere.
Pi advertises skill names and descriptions to the model so matching requests resolve to skills automatically; `/skill:<name>` remains the explicit forced form, so a duplicate prompt is unnecessary merely to match Claude Code's `/<name>` spelling.

## Installation Details

`install.sh` is a **generic loop over harness modules** (`harnesses/*/manifest.sh`, per [ADR-0010](docs/adr/0010-modular-harness-modules-and-isolation.md)) — adding a harness is dropping in a module, removing one is deleting its directory. For each module it:

1. Reads the module's `manifest.sh` (its `config_root`, shared categories, native `command_target`, and `install_module` hook).
2. **Mirrors each module's consumed shared set** into its config root. Skills and agents reach both harnesses; rules remain at their canonical source path.
3. **Projects shared commands** into Claude's `commands/` or pi's `prompts/` directory according to the manifest.
4. **Installs module files and global instructions** via each manifest (Claude: `CLAUDE.md`, `settings.json`, `statusline.sh`, `hooks.json`; pi: `AGENTS.md`, settings, extensions).
5. **Prunes dangling links** so the install self-heals after a rename/delete.
6. Links the standalone `review-change` executable into `~/.local/bin/` independently of either harness.
7. Skips any `harness_pending` modules.

Finally it sets `core.hooksPath` to `.githooks`. The guard core in `shared/` is resolved by the adapters via symlink realpath, so it is not separately mirrored.

Claude and pi consume the same skill and command sources directly ([ADR-0025](docs/adr/0025-project-shared-commands-as-native-prompts.md)).
Skills remain discoverable capabilities, while curated commands exist only for aliases or compositions that add value beyond skill discovery.

## Infrastructure

### Test Pipeline

`make test` runs every check across four categories — `test/content`,
`test/install`, `test/guard`, `test/meta` (run `make` to list them; `VERBOSE=1`
shows every individual check). The `test/content` + `test/install` categories
(`scripts/test-pipeline.sh`) validate the repository's internal consistency:

- **Frontmatter**: Skills need name/description, and agents need name/description/tools
- **Phase content**: Grill skill must mention `CONTEXT.md`, spec must mention "User Stories", tasks must mention "vertical slice", implement must mention vertical-slice TDD, etc.
- **Cross-references**: Agent files referenced from skills must exist
- **Agent rule dependencies**: Rule files referenced in agent bodies must exist
- **Symlink targets**: All files that `install.sh` would symlink must exist
- **Guide/skill sync**: HTML guide files must reference the same agents as SKILL.md
- **Stale stubs**: Short files with redirect language are flagged

`scripts/test-pipeline-self-test.sh` is a meta-test that creates intentionally broken files to verify the test pipeline catches each error class.

### CI

`.builds/mirror.yml` — sr.ht CI mirrors the repository to GitHub on push.

## Acknowledgements

This project stands on the shoulders of others:

- **[Boris Tane's Claude Code workflow](https://boristane.com/blog/how-i-use-claude-code/)** — The review-cycle discipline and think-before-you-code guardrails originated in Boris's research → plan → implement method. This project's first pipeline was a direct port before review artifacts became HTML-native.
- **[Matt Pocock's skills-TDD pipeline](https://www.aihero.dev/skills-tdd)** and the broader [skills repo](https://github.com/mattpocock/skills) — the core pipeline (`grill-with-docs → to-prd → to-issues → tdd`) and Matt's stance on vertical-slice TDD ("write one test, one implementation, repeat — batched tests describe imagined behavior, not actual behavior") drive the design of `/grill`, `/spec`, `/todo`, and the vertical-slice rewrites of `/code` and `/coach`. The standalone tools `/handoff` ([article](https://www.aihero.dev/skills-handoff)), `/prototype`, and `/review-code` (renamed from `improve-codebase-architecture`) are also ports of Matt's skills, with internal references rewritten to match this repo's naming. The `model-domain` skill adapts his `domain-modeling` skill with this repository's ubiquitous-language, standalone-audit, context-map, and ADR conventions.
The `/resolve-conflicts` command adapts Matt's [`resolving-merge-conflicts`](https://github.com/mattpocock/skills/blob/main/skills/engineering/resolving-merge-conflicts/SKILL.md) workflow with an HTML decision artifact for incompatible hunks.
The format files (CONTEXT-FORMAT.md, ADR-FORMAT.md) and the LANGUAGE/DEEPENING/HTML-REPORT/INTERFACE-DESIGN supporting docs are taken directly from his repo.
- **[nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer)** — The `visualize` skill (renamed from `visual-explainer`) is taken wholesale from this repository, with only minor modifications. HTML visual generation is powered by this work.
- **[kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes)** — Review change adapts its independent reviewer/fixer roles, intent-aware Findings, evidence-first validation, bounded repair loops, and human-owned decisions without reproducing its push gate, daemon, TUI, or delivery automation.
- **[kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi)** — The local browser review loop, path-keyed sessions, element and text annotations, foreground polling, live reload, and evidence-based layout warnings inspired `review-artifact`. Relevant MIT-licensed core concepts and code were adapted into the narrower locally owned runtime; see [`skills/review-artifact/ATTRIBUTION.md`](skills/review-artifact/ATTRIBUTION.md).
- **[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)** — The rules and agent definitions in this repo are borrowed and adapted from this collection. The coding-style, testing, security, and performance rules, as well as several retained specialist-agent configurations, draw heavily from this source.
- **[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)** — Its TTSR and hook models informed the guardrail architecture before the harness was retired by [ADR-0017](docs/adr/0017-retire-oh-my-pi.md).
- **[pi (badlogic/earendil-works)](https://pi.dev)** — The second harness this repo configures (`@earendil-works/pi-coding-agent`, config root `~/.pi/agent`). Its `tool_call` extension routes the shared guard core, while its global `AGENTS.md` carries only the small shared bootstrap and detailed rules remain on demand ([ADR-0016](docs/adr/0016-small-always-on-bootstrap-lazy-rulebooks.md)).

## License

MIT — see [LICENSE](LICENSE).
