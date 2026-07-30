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
A file-backed capability pack discoverable by name, defined by `<root>/skills/<name>/SKILL.md`. Loaded as lightweight metadata in the system prompt and read on demand. Shared across all harnesses without per-harness translation.

**Command** (slash command):
A `<root>/commands/<name>.md` file invoked by the user as `/<name>`. Frontmatter is parsed; body is rendered as a prompt template with `$ARGUMENTS` / `$1` substitutions.

**Agent** (subagent):
A specialized sub-runtime invoked by the main session through its subagent tool. Defined in `<root>/agents/<name>.md` with a tool allowlist in frontmatter.
_Avoid_: Worker, child session.

**Rule**:
A `<root>/rules/<name>.md` file holding guidance the harness pulls into context on demand. Claude and pi read the canonical `~/.dotfiles/ai/rules/` files directly. See [`small-always-on-bootstrap-lazy-rulebooks`](docs/adr/0016-small-always-on-bootstrap-lazy-rulebooks.md).

### Harness-specific terms

**`.claude` / `~/.claude/`**:
Claude Code's config root. This repo's `harnesses/claude/` module contains `settings.json`, `statusline.sh`, `hooks.json`, the tier-B guard shim `hooks/guard.ts`, and a `manifest.sh`, all symlinked into `~/.claude/` by `install.sh`. Skills, commands, and agents use their conventional directories; detailed rules remain at the canonical `~/.dotfiles/ai/rules/` path so Claude does not auto-inject them, and `~/.claude/CLAUDE.md` supplies the small global bootstrap.

**`.pi` / `~/.pi/agent/`**:
pi's config root. This repo's `harnesses/pi/` module contains settings, extensions, a bundled tier-A guard adapter, and a `manifest.sh`. Skills and agents use their conventional directories; detailed rules remain at the canonical `~/.dotfiles/ai/rules/` path, and `~/.pi/agent/AGENTS.md` supplies the small global bootstrap.

### Lifecycle terms

**Always-on context**:
Content the harness injects into every conversation's system prompt without the model having to ask for it. This repo keeps that surface to `harness-system-prompt.md` for Claude and pi: a critical baseline plus the shared rule location and load triggers. Claude Code would also auto-load `~/.claude/rules/*.md`, so this repo deliberately leaves detailed rules only at the canonical source path.

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
Closing or ending the session without approval does not clear a pipeline gate.
_Avoid_: artifact review, annotation cycle, inline `//` review.

**Pipeline skill**:
One of the nine skills the `/build` orchestrator drives through its five phases and supporting review workflow — `build`, `grill`, `spec`, `todo`, `code`, `coach`, `review-code`, `visualize`, `review-artifact`.
Distinct from a **standalone skill** (`refactor`, `handoff`, `pickup`, `prototype`) which is invoked on its own, never orchestrated by `/build`.
(`review-code` also runs standalone — diff-scoped inside the pipeline, whole-codebase or area-scoped on its own — like `grill`/`spec`/`todo` do.)
_Avoid_: phase (a phase is a stage of the pipeline; a pipeline skill is the unit that runs it).

**Progressive disclosure**:
The skill-authoring convention where `SKILL.md` is a thin entry point that defers heavy detail to `references/*.md` files read on demand, instead of one monolithic file. Detail used by more than one skill lives in a global `skills/shared/references/` directory and is imported by relative path rather than duplicated (e.g. `spec`/`todo`/`code` read `../shared/references/build-pipeline.md`); detail used by a single skill lives in that skill's own `references/`.
_Avoid_: lazy loading.

**Feature directory**:
The per-build-run home for canonical HTML review artifacts: `docs/features/<YYYYMMDD-HHMM>-<slug>/`, holding `specs.html`, `tasks.html`, and `diff-review.html`.
Project-wide artifacts (`CONTEXT.md`, `docs/adr/`) live at the repo root and accrete across runs.
_Avoid_: `docs/claude/` (the former Claude-specific name, replaced by the harness-neutral `docs/features/` — see [`adopt-docs-features-over-docs-claude`](docs/adr/0007-adopt-docs-features-over-docs-claude.md)), Markdown companions.

**Hygiene sweep**:
The automatic, plan-less cleanup of just-changed files — dead code, unused imports and dependencies, duplicate consolidation, simplification, idiom fixes — executed by the `refactorer` agent in hygiene mode. Runs unattended as the single "Refactor" step of the post-implementation review chain, and standalone when `/refactor` is given a vague goal ("clean up X"). SAFE changes are applied directly; CAREFUL/RISKY findings are reported, never auto-applied. Never commits.
_Avoid_: clean up / refactor cleanup (the two former review-chain step names whose overlap this term resolves), `code-cleaner`, `refactor-cleaner` (the retired components it replaces).

**Directed refactor**:
A user-named structural transformation — extract, inline, move, rename, restructure, decouple — run through the `/refactor` skill: goal → numbered transformation plan → explicit user approval → the `refactorer` agent executes incrementally in plan mode, testing between steps and reverting on failure. Distinct from a **hygiene sweep** by trigger (user goal vs automatic), scope (whatever the goal touches vs changed files), and gate (plan approval vs none).
_Avoid_: refactoring (unqualified — hides the directed-vs-hygiene split).

## Example dialogue

> **Dev**: I want to add `/refactor` so it works in both harnesses.
> **Expert**: Claude exposes slash commands, while pi uses skills and prompt templates. Put reusable behavior in `skills/refactor/SKILL.md`; add `commands/refactor.md` only when Claude needs a command-shaped entry point. The installer projects each resource only into harnesses that consume that category.
>
> **Dev**: And `security.md` — I never want any harness reading my `.env`. Same deal, just share the rule?
> **Expert**: No — that's the split. `security.md` as *guidance* is an **advisory rule** and shares fine. But "never read secrets" as an *enforced* constraint is a **guardrail policy**: it gets an ID in the **policy registry**, the detection lives once in the **guard core** (`isSecretPath`), and each **harness module** wires that core in via its **enforcement tier** — pi runs it in-process (tier A), while Claude runs it through a stdin/stdout shim (tier B). The **conformance test** proves both harnesses cover it because `no-secret-access` is in the **mandatory policy floor**.
