# ai-config

A single configuration source that powers Claude Code and pi. Skills, commands, agents, and rules are authored once and installed into each via `install.sh`.

## Language

### Core concepts

**Harness**:
The runtime program that drives an LLM through tool calls, system prompts, and a session UI — Claude Code and pi are the two this repo configures. Per-harness config lives in a self-contained **harness module** under `harnesses/` — `harnesses/claude/` and `harnesses/pi/` (see [`modular-harness-modules-and-isolation`](docs/adr/0010-modular-harness-modules-and-isolation.md)).
_Avoid_: Tool (overloaded with the Bash/Read/Edit primitives a harness gives the model), assistant, agent (overloaded with subagent), AI coding tool.

**Tool**:
A primitive the harness exposes to the model — `Bash`, `Read`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `Glob`, `Grep`, and so on. Distinct from a harness, which is the program that hosts the tools.
_Avoid_: Capability, primitive in user-facing copy.

**Skill**:
A file-backed capability pack discoverable by name, defined by `<root>/skills/<name>/SKILL.md`.
It is loaded as lightweight metadata in the system prompt and read on demand, and it is shared across all harnesses without per-harness translation.
Pi can resolve a matching request to a skill from its advertised name and description, while `/skill:<name>` remains available to force explicit invocation.
Therefore a shared skill does not need a same-purpose prompt merely to reproduce Claude Code's `/<name>` spelling in pi.

**Command**:
An explicit slash-workflow prompt authored at `<root>/commands/<name>.md`.
A command either aliases a differently named skill or composes multiple skills, and may not duplicate a same-named skill.
It exists only when the shortcut or composition adds value beyond automatic skill discovery.
Claude Code consumes commands from `~/.claude/commands/`, while pi consumes the same files as prompt templates from `~/.pi/agent/prompts/`.

**Agent** (subagent):
A specialized sub-runtime invoked by the main session through its subagent tool. Defined in `<root>/agents/<name>.md` with a tool allowlist in frontmatter.
_Avoid_: Worker, child session.

**Rule**:
A `<root>/rules/<name>.md` file holding guidance the harness pulls into context on demand. Claude and pi read the canonical `~/.dotfiles/ai/rules/` files directly. See [`small-always-on-bootstrap-lazy-rulebooks`](docs/adr/0016-small-always-on-bootstrap-lazy-rulebooks.md).

**Ubiquitous language**:
The shared, canonical vocabulary that domain experts, users, documentation, tests, and code use with one consistent meaning to describe a project's domain.
`CONTEXT.md` records this language, while the `model-domain` skill actively builds, augments, and audits it.
_Avoid_: Domain language, project vocabulary, `CONTEXT.md` vocabulary.

### Harness-specific terms

**`.claude` / `~/.claude/`**:
Claude Code's config root. This repo's `harnesses/claude/` module contains `settings.json`, `statusline.sh`, `hooks.json`, the tier-B guard shim `hooks/guard.ts`, and a `manifest.sh`, all symlinked into `~/.claude/` by `install.sh`. Skills and agents use their conventional directories; shared commands install into `~/.claude/commands/` and expose `/<name>`. Detailed rules remain at the canonical `~/.dotfiles/ai/rules/` path so Claude does not auto-inject them, and `~/.claude/CLAUDE.md` supplies the small global bootstrap.

**`.pi` / `~/.pi/agent/`**:
pi's config root. This repo's `harnesses/pi/` module contains settings, extensions, a bundled tier-A guard adapter, and a `manifest.sh`. Skills and agents use their conventional directories; shared commands install as prompt templates in `~/.pi/agent/prompts/` and expose `/<name>`. Detailed rules remain at the canonical `~/.dotfiles/ai/rules/` path, and `~/.pi/agent/AGENTS.md` supplies the small global bootstrap.

### Lifecycle terms

**Always-on context**:
Content the harness injects into every conversation's system prompt without the model having to ask for it. This repo keeps that surface to `harness-system-prompt.md` for Claude and pi: a critical baseline plus shared project classification and rule-loading triggers. Claude Code would also auto-load `~/.claude/rules/*.md`, so this repo deliberately leaves detailed rules only at the canonical source path.

**A5 project**:
A repository whose originating repository has effective global or system Git configuration `ai.projectFamily=a5`.
Repository-local configuration cannot grant this classification.
The Git dotfiles A5 include is the machine-readable source, so linked worktrees, disposable review copies, Orchard, and harness workflows share one classification.

### Worktree lifecycle terms

**Worktree intent**:
The concise normalized task identifier Orchard uses to name and select a worktree independently of its assigned branch name.
_Avoid_: Branch name, worktree path.

**Main project directory**:
The primary repository checkout from which changes are integrated onto **trunk**.
Delivery integration never runs from another linked worktree.
_Avoid_: Main worktree, root repo, original clone.

**Trunk**:
The repository's primary integration branch, resolved from repository metadata rather than assumed to be named `main`.
_Avoid_: Main (unless that is the branch's actual name), default branch when discussing integration policy.

**Local task branch**:
A named feature branch worked directly in the **main project directory**.
It is the default home for ordinary work and may later be converted into a **task worktree**.
_Avoid_: Local branch (all non-remote Git branches are local), main-repo branch.

**Project group**:
The directory beneath `~/.orchard/` that owns one repository's worktree pool, lifecycle state, and lock.
Its ordinary name is the project basename; when that name is already owned by another repository, only the new group prepends the main project directory's parent name.

**Worktree pool**:
The reusable set of managed Git worktrees inside one **project group**.
Each member is either an **available worktree** or a **task worktree**.

**Available worktree**:
A clean, detached, pre-warmed member of a **worktree pool** aligned with **trunk** and eligible for acquisition.
_Avoid_: Empty worktree, spare clone.

**Task worktree**:
A **worktree pool** member exclusively assigned to one task and attached to that task's named feature branch.
It remains task-owned while dirty or unmerged.
_Avoid_: Leased worktree (a lease is ownership metadata, not the worktree's lifecycle role), feature clone.

**Branch binding**:
The invariant that a **task worktree**'s registered path remains attached to its assigned branch throughout the task lifecycle.
_Avoid_: Current branch (describes an observation rather than the durable path-to-branch association).

**Quarantine**:
The durable fail-closed state that excludes a worktree from ordinary lifecycle operations when its identity or integrity is uncertain.
_Avoid_: Error state, disabled worktree.

**Repair**:
The explicit verified restoration of a quarantined **task worktree** after its recorded **branch binding** has been re-established.
_Avoid_: Refresh, unquarantine (each implies that current appearance alone is sufficient).

**Convert**:
The recoverable transition of a **local task branch** into a **task worktree** without changing branch identity.
Conversion preserves staged, unstaged, and untracked work; ignored files remain with their original working directory.
_Avoid_: Move (ambiguous about branch and working state), migrate (implies a permanent storage change).

**Orchard CLI**:
The standalone lifecycle authority installed by the Git dotfiles repository at `~/.local/bin/orchard`.
It owns Git and filesystem transitions without depending on an AI harness and exposes a versioned structured protocol for automation.
AI skills, prompts, and adapters invoke it as an external command rather than importing or duplicating its implementation.
Orchard owns delivery strategy selection from trusted Git configuration, interactive commit prompting, synchronization, rebasing, local fast-forward integration, pull-request form opening, and cleanup state.
_Avoid_: Orchard skill (the AI workflow surface), harness adapter (the native parent-session transition layer).

**Worktree transition**:
The Orchard-owned continuation of an interactive caller inside an acquired or selected **task worktree**.
A harness continues in its current visible interface through its native worktree or session-switching capability, while a terminal caller enters through its shell.
The **Orchard CLI** selects and validates the destination, while an AI harness adapter performs the native parent-session transition that a child process cannot perform itself.
Claude Code records a live Orchard ownership claim, enters through its native existing-worktree operation, returns through its native exit operation with keep behavior, and releases the exact claim so Orchard alone owns worktree cleanup.
Pi preloads a one-time authenticated transition command into an empty editor; the user presses Enter once so pi can run its privileged session-switching context without another model turn or typed command text.
`/build` delegates this transition to Orchard when it starts outside a linked worktree and executable preflight succeeds.
When preflight fails before acquisition, `/build` may continue on a **local task branch** only after warning and receiving explicit approval; that degraded path is not a worktree transition.
_Avoid_: Handoff (transfers work to an independently started session), relocation (describes only the directory change).

**Landed**:
The state in which a **task worktree**'s exact feature tip is proven integrated into **trunk**.
Git ancestry is authoritative; read-only forge metadata is a fallback for squash or rebase merges.
_Avoid_: Merged (ambiguous about merge strategy and whether the exact local tip was included), closed.

**Recycle**:
The verified transition of a clean, **landed** **task worktree** back into an **available worktree**.
Recycling detaches the worktree from its completed feature branch without discarding unlanded work.
_Avoid_: Delete, reset, return (each describes only part of the transition).

### Harness-modularity & guardrail terms

**Harness module**:
A self-contained directory holding everything specific to one harness — its runtime config file(s), its guardrail adapter, and a declaration of which **config root** it installs into and which shared categories it consumes. Adding or removing a harness is adding or removing one module; `install.sh` is a generic loop over the modules that exist.
_Avoid_: harness folder, plugin, per-harness block.

**Config root**:
The home-directory location a harness reads its config from — `~/.claude/` or `~/.pi/agent/`. Each config root is owned **exclusively** by one harness module.

**Isolation invariant**:
The guarantee that each harness sees only its own module's files plus the curated shared set — never content leaked from a sibling harness. Verified by the **isolation test**. Distinct from **sandboxing** (runtime VM isolation of a harness process — a different, orthogonal concept).

**Isolation test**:
The check asserting each config root contains only `{its module's files} ∪ {the curated shared set}` — no symlink may resolve into a sibling harness's directory. A leak fails CI.

**Advisory rule**:
A `rules/*.md` file that is pure guidance the model reads — shares verbatim across harnesses like a skill, with no mechanical enforcement. After the guardrail consolidation (ADR-0012), **`rules/` is advisory-only**: `coding-style`, `testing`, `performance`, `git-commit`, `mise`, and `security` (its non-blockable principles). All *enforcement* moved to the **guard core**. Distinct from a **Guardrail policy**.
_Avoid_: rule (unqualified — the bare word hides the advisory-vs-guardrail split).

**Rule projection**:
How advisory rules reach a harness. **Claude** and **pi** read ordinary files from the canonical `~/.dotfiles/ai/rules/` directory and share the same small always-on bootstrap for routing. Enforcement, by contrast, travels through the **guard core**, not rule projection. (ADR-0016)

**Global instruction bootstrap**:
The small harness-neutral `harness-system-prompt.md` installed as Claude's `~/.claude/CLAUDE.md` and pi's `~/.pi/agent/AGENTS.md`. It contains only critical cross-task constraints, rulebook locations, and load triggers. It is distinct from the repo-root `AGENTS.md`, which is this repository's authoring contract and is never installed globally.

**Context file** (pi):
A file pi loads at startup: global `~/.pi/agent/AGENTS.md` (the bootstrap) and `SYSTEM.md` (replaces the system prompt), plus project `AGENTS.md`/`CLAUDE.md` discovered walking up from cwd. Pi reads named context files, not arbitrary rule directories, so detailed rule loading remains an explicit model action.

**Guardrail policy**:
A security/safety constraint with a *shared intent* but a *per-harness enforcement mechanism* (e.g. never read secrets, never write a secret literal, no curl-pipe-to-shell, no cloud teardown). Recorded once in the **policy registry** and projected into each harness via its adapter.
_Avoid_: rule, permission (a permission is the native allow/deny knob a policy may *project onto*, not the canonical constraint itself).

**Policy registry**:
The canonical, harness-neutral list of guardrail policies in `shared/policy-registry.ts` — one entry per policy: an **ID**, intent, enforcement metadata (check kind: `command` / `path` / `content` / `secret`; `floor` flag), and boundary examples (a violating `example` + benign `counterExample`). The single source of truth for *what* must be enforced.

**Guard core**:
The shared TypeScript module implementing the *detection* logic for guardrail policies over a normalized tool call (`tool`, `command`, `path`, and write **`content`**) — `isSecretPath`, `isCurlPipeShell`, `isHardcodedSecret`, …, imported unchanged by every harness whose hook API can run it. The single source of truth for *how* a policy is detected.
_Avoid_: hook (a harness's event surface), matcher.

**Enforcement tier** (a.k.a. **adapter archetype**):
The classification of a harness by *how* it can enforce policies — **A** programmable (runs the guard core in-process: pi), **B** command-hook (runs the guard core via an external command + shim: Claude Code), **C** declarative (static allow/deny patterns only), **D** sandbox (environment isolation, e.g. Gondolin), **E** guidance (prompt text only). A new harness maps to one or more tiers; each tier has a reusable adapter.
_Avoid_: harness type.

**Coverage matrix**:
The policy × harness table produced by the **conformance test**, recording how each policy is enforced — or an explicitly acknowledged gap — for each harness.

**Conformance test**:
The check that every harness covers the **mandatory policy floor** and that every other policy is either enforced or has an *explicit* (never silent) gap in the coverage matrix.

**Mandatory policy floor**:
The subset of guardrail policies every harness must enforce (at tier A/B/C/D strength) to be admitted to the fleet — e.g. `no-secret-access`. A harness that cannot meet the floor must be **sandboxed or rejected**.
_Avoid_: baseline.

### Build-pipeline terms

**Spec**:
The canonical Phase-2 review artifact of the `/build` pipeline — `specs.html`, containing user stories plus implementation and testing decisions, synthesized by the `spec` skill from a grill session.
Its approval event is the Spec→Tasks gate.
_Avoid_: PRD / prd.md / prd.html (the artifact's former name, renamed 2026-07-09), plan (the pre-pipeline document format the spec replaced), Markdown companion.

**Review artifact**:
A canonical semantic HTML document presented through the **review artifact workflow** when the pipeline needs feedback or approval.
It is the durable source consumed by later phases, not a visual companion to Markdown.
_Avoid_: visual companion, Markdown artifact.

**Review artifact workflow**:
The local browser feedback loop provided by the `review-artifact` skill for a **review artifact**: the user annotates elements or text, sends feedback, or emits an explicit approval event while the agent polls and updates the same HTML document.
The shell and HTTP boundary share validation for transient and durable review messages, and a serialized local per-daemon capability limits event consumption to agent commands.
Closing or ending the session without approval does not clear a pipeline gate.
_Avoid_: artifact review, annotation cycle, inline `//` review.

**Pipeline skill**:
A skill the `/build` skill orchestrator drives through its five phases and supporting review workflow — `build`, `grill`, `spec`, `todo`, `code`, `coach`, **Review change**, and `review-artifact`.
Some pipeline skills also run standalone, including `grill`, `spec`, `todo`, and **Review change**.
Distinct from a **standalone skill** (`refactor`, `review-code`, `handoff`, `pickup`, `prototype`) that `/build` never invokes automatically.
_Avoid_: phase (a phase is a stage of the pipeline; a pipeline skill is the unit that runs it).

**Authoritative intent**:
The explicit acceptance context a **Review change** uses to distinguish a defect from a deliberate choice.
Build mode takes it from approved canonical `specs.html` and `tasks.html`; pull-request mode takes it from the sanitized PR title and body, augmented or overridden by explicit `/review-change` or `review-change --intent` arguments.
_Avoid_: Diff summary, inferred intent, prompt instructions.

**Finding**:
A substantiated issue or observation produced by a **Review change**, classified independently by severity (`error`, `warning`, `info`) and action (`auto-fix`, `ask-user`, `no-op`).
An absent or uncertain action fails closed to `ask-user` so intent-sensitive decisions remain human-owned.
Severity describes impact: `error` should not merge without repair or override, `warning` may be accepted for follow-up, and `info` records context.
Action describes who decides next: `auto-fix` is an objective low-risk build repair, `ask-user` needs a human decision, and `no-op` requests no action; standalone reports never mutate from a tag.
Every reportable Finding has an exact changed `path:line`, uses project terminology, and defines any unavoidable new term.
_Avoid_: Comment, suggestion, concern.

**Validation evidence**:
The smallest relevant tests, checks, and reviewer-visible artifacts that substantiate the **Authoritative intent** without repeating a repository-wide suite.
If focused evidence cannot establish an intent criterion, the **Review change** emits an `ask-user` warning instead of claiming success.
_Avoid_: Test suite, CI result, confidence.

**Trusted change**:
A build or local-range change, a remote pull request explicitly trusted by the user or isolated by a documented sandbox, or a pull request whose originating repository is an A5 project.
Only a Trusted change may execute local tests, linters, hooks, or package scripts; other remote pull requests remain unmaterialized and use static inspection of immutable Git objects plus provider CI as **Validation evidence**.
_Avoid_: Same-repository change, disposable worktree, trusted author.

**Review change report**:
A disposable, self-contained HTML document containing intent, risk, **Findings**, validation evidence, and, in build mode, a persistent decision ledger and complete chat fallback.
Build mode presents it as a **review artifact** through the interactive **review artifact workflow**, allowing selected repairs and explicit approval after every `ask-user` Finding has a disposition.
Standalone modes present it as read-only results by opening it once with the platform viewer, without `review-artifact`, feedback polling, or approval.
It lives in the OS temporary directory, updates in place across build fix rounds, and never becomes a repository artifact.
_Avoid_: Architecture review report, diff review, build artifact.

**Change reviewer**:
The read-only adversarial agent that performs a complete review of the current change against **Authoritative intent**.
Each review round starts fresh with the intent and prior decision ledger, never the **Change fixer** rationale.
_Avoid_: Code reviewer, architecture reviewer.

**Change fixer**:
The repair agent that applies selected objective **Findings** within mode ownership without sharing its rationale or session with the **Change reviewer**.
Build modes may invoke it within their ownership rules; standalone CLI reviews, explicit ranges, and pull requests never do.
_Avoid_: Reviewer, refactorer.

**Review change**:
The mandatory final `/build` phase: a fixed validation of a specific change against its **Authoritative intent** through adversarial review, targeted evidence, documentation checks, then lint.
AI build mode may run up to three automatic fix/recheck rounds per stage; pull requests, explicit branches or local ranges, and standalone CLI reviews report Findings without mutation.
Coached build mode preserves user ownership of source and tests, applying only documentation and mechanical formatting fixes automatically while guiding the user through source fixes.
Delivery automation and optional standalone `review-code` architectural exploration remain outside this phase.
Its terminal decision is presented through a **Review change report**.
_Avoid_: No-mistakes, code review (too broad), architecture review.

**Review change CLI**:
The standalone `review-change` executable that runs **Review change** through an isolated foreground pi process without requiring an existing agent session.
It accepts branch names, local ranges, and pull-request targets read-only and snapshots the current tracked and untracked state into a disposable isolated clone under `~/.review-orchard/`, separate from development worktrees under `~/.orchard/`, before launching pi.
Its CLI-specific pi guard blocks writes within that clone plus staging, commits, pushes, and provider mutations; the original checkout and Git metadata remain outside the child process workspace.
In a TTY it renders target resolution, isolation, adversarial review, targeted evidence, documentation, lint, report generation, cleanup, and a final Summary stage within the same color-coded full-screen pipeline/log layout with `NO_COLOR` support and navigable bounded and credential-redacted per-stage action and outcome logs.
The header retains the isolated review worktree path, immutable scope, risk, and open Findings; Resolve target and Create isolation use concise left-pane outcomes without repeating target URLs, workspace/report paths, or snapshot details; Cleanup displays only `Removed`; the parent validates ordered successful telemetry, uses a wide-terminal left-right pipeline/log split, lists each stage purpose and sub-stages vertically in the left pane with a live or completed elapsed timer beside every sub-stage, bounds left-pane sub-stage labels to six words, marks the active sub-stage, lists each concise Finding, missing-evidence item, documentation issue, or similar collected result on its own line without repeating successful completion text, and retains bounded original sub-stage messages as right-pane `STEP` log entries, opens the completed report in a new Firefox window on macOS, or the platform HTML viewer elsewhere, without waiting for browser closure, owns cancellation through final Summary dismissal, and uses `j`/`k` to navigate stages, Ctrl-D/Ctrl-U for selected-log scrolling, Enter to expand or collapse lines, `f` to follow the active stage, and Ctrl-C as the only active-run abort key, and keeps the existing pipeline/log layout while showing the report path plus complete Ctrl-D/Ctrl-U-scrollable parent and assistant summaries in the final stage until Ctrl-C exits the completed review; Ctrl-D remains dedicated to downward scrolling, and `q`, `x`, and Escape do not close it.
When available, non-interactive `glow` renders that final Markdown at the panel width, forces color when terminal color is enabled, and rerenders it after width changes; a Summary pane narrower than 20 columns or missing, failed, oversized, or timed-out Glow output falls back to the built-in summary renderer.
It never starts `review-artifact` or waits for approval, emits no duplicate summary into the restored interactive shell, exposes observable activity rather than hidden model reasoning, and falls back to plain status lines plus a textual summary when output is not interactive.
_Avoid_: no-mistakes remote, delivery gate, pi session.

**Progressive disclosure**:
The skill-authoring convention where `SKILL.md` is a thin entry point that defers heavy detail to `references/*.md` files read on demand, instead of one monolithic file. Detail used by more than one skill lives in a global `skills/shared/references/` directory and is imported by relative path rather than duplicated (e.g. `spec`/`todo`/`code` read `../shared/references/build-pipeline.md`); detail used by a single skill lives in that skill's own `references/`.
_Avoid_: lazy loading.

**Feature directory**:
The per-build-run home for canonical HTML review artifacts: `docs/features/<YYYYMMDD-HHMM>-<slug>/`, holding `specs.html` and `tasks.html`.
The **Review change report** is disposable and stays in the operating-system temp directory; project-wide artifacts (`CONTEXT.md`, `docs/adr/`) live at the repo root and accrete across runs.
_Avoid_: `docs/claude/` (the former Claude-specific name, replaced by the harness-neutral `docs/features/` — see [`adopt-docs-features-over-docs-claude`](docs/adr/0007-adopt-docs-features-over-docs-claude.md)), Markdown companions.

**Hygiene sweep**:
The automatic, plan-less cleanup of just-changed files — dead code, unused imports and dependencies, duplicate consolidation, simplification, idiom fixes — executed by the `refactorer` agent in hygiene mode.
It closes implementation before Review change and also runs standalone when `/refactor` is given a vague goal ("clean up X").
SAFE changes are applied directly; CAREFUL/RISKY findings are reported, never auto-applied.
Never commits.
_Avoid_: clean up / refactor cleanup (the two former review-chain step names whose overlap this term resolves), `code-cleaner`, `refactor-cleaner` (the retired components it replaces).

**Directed refactor**:
A user-named structural transformation — extract, inline, move, rename, restructure, decouple — run through the `/refactor` skill: goal → numbered transformation plan → explicit user approval → the `refactorer` agent executes incrementally in plan mode, testing between steps and reverting on failure. Distinct from a **hygiene sweep** by trigger (user goal vs automatic), scope (whatever the goal touches vs changed files), and gate (plan approval vs none).
_Avoid_: refactoring (unqualified — hides the directed-vs-hygiene split).

## Example dialogue

> **Dev**: I want to add `/refactor` so it works in both harnesses.
> **Expert**: Put the reusable workflow in `skills/refactor/SKILL.md`. Claude registers that skill as `/refactor`, while pi registers it as `/skill:refactor`; no wrapper is needed.
>
> **Dev**: And `security.md` — I never want any harness reading my `.env`. Same deal, just share the rule?
> **Expert**: No — that's the split. `security.md` as *guidance* is an **advisory rule** and shares fine. But "never read secrets" as an *enforced* constraint is a **guardrail policy**: it gets an ID in the **policy registry**, the detection lives once in the **guard core** (`isSecretPath`), and each **harness module** wires that core in via its **enforcement tier** — pi runs it in-process (tier A), while Claude runs it through a stdin/stdout shim (tier B). The **conformance test** proves both harnesses cover it because `no-secret-access` is in the **mandatory policy floor**.
>
> **Dev**: Should this small fix get a worktree now, in case it grows?
> **Expert**: No. Start with a **local task branch** unless you explicitly want isolation; `/build` is the exception and must run in a linked worktree. It continues inside an existing linked worktree without adopting it, or acquires a **task worktree** through Orchard when started from the **main project directory**. If an ordinary task grows, convert its branch without changing its identity.
>
> **Dev**: The feature is delivered. Can I remove its task worktree now?
> **Expert**: Let Orchard apply the configured delivery strategy. Local delivery from the **main project directory** recycles immediately when safe; pull-request delivery retains the task until landing is proven and explicit recycling is safe.
