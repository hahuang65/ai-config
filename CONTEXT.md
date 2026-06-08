# ai-config

A single configuration source that powers multiple AI coding harnesses (Claude Code and oh-my-pi). Skills, commands, agents, and rules are authored once and installed into each via `install.sh`.

## Language

### Core concepts

**Harness**:
The runtime program that drives an LLM through tool calls, system prompts, and a session UI — Claude Code and oh-my-pi are the two this repo configures. Per-harness config lives in a self-contained **harness module** under `harnesses/` — `harnesses/claude/`, `harnesses/omp/`, with a pending `harnesses/pi/` slot (see [`modular-harness-modules-and-isolation`](docs/adr/0010-modular-harness-modules-and-isolation.md)).
_Avoid_: Tool (overloaded with the Bash/Read/Edit primitives a harness gives the model), assistant, agent (overloaded with subagent), AI coding tool.

**Tool**:
A primitive the harness exposes to the model — `Bash`, `Read`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `Glob`, `Grep`, and so on. Distinct from a harness, which is the program that hosts the tools.
_Avoid_: Capability (oh-my-pi-internal jargon for its discovery registry), primitive in user-facing copy.

**Skill**:
A file-backed capability pack discoverable by name, defined by `<root>/skills/<name>/SKILL.md`. Loaded as lightweight metadata in the system prompt and read on demand. Shared across both harnesses without per-harness translation.

**Command** (slash command):
A `<root>/commands/<name>.md` file invoked by the user as `/<name>`. Frontmatter is parsed; body is rendered as a prompt template with `$ARGUMENTS` / `$1` substitutions.

**Agent** (subagent):
A specialized sub-runtime invoked by the main session via the Task tool (Claude Code) or `task` tool (oh-my-pi). Defined in `<root>/agents/<name>.md` with a tool allowlist in frontmatter.
_Avoid_: Worker, child session.

**Rule**:
A `<root>/rules/<name>.md` file holding guidance the harness can pull into context. Claude Code injects them automatically as global user instructions on every turn. oh-my-pi puts them in the **rulebook** (a system-prompt index of `name + description` entries that the model reads on demand via `rule://<name>`) — see [`description-only-rules-in-rulebook`](docs/adr/0002-description-only-rules-in-rulebook.md) for why this repo deliberately picks the lazy-load bucket over `alwaysApply: true`.

### Harness-specific terms

**`.claude` / `~/.claude/`**:
Claude Code's config root. This repo's `harnesses/claude/` module contains `settings.json`, `statusline.sh`, `hooks.json`, the tier-B guard shim `hooks/guard.ts`, and a `manifest.sh`, all symlinked into `~/.claude/` by `install.sh`. Skills, commands, agents, rules live under `~/.claude/{skills,commands,agents,rules}/` as symlinks back to the repo.

**`.omp` / `~/.omp/agent/`**:
oh-my-pi's config roots — project-level (`<cwd>/.omp/`) and user-level (`~/.omp/agent/`, with the extra `agent` subfolder). This repo's `harnesses/omp/` module holds oh-my-pi-specific config (`config.yml`, `RULES.md`, `extensions/`, `hooks/`, `manifest.sh`).

**Source priority** (oh-my-pi):
oh-my-pi's built-in ordering for cross-harness config discovery — higher number wins on name collisions: `.omp` (100) > `.claude` (80) > `.codex` (70) > `.gemini` (60) > `.opencode` (55). Means our `~/.claude/skills/` is discoverable by oh-my-pi without any new symlinks — but `~/.claude/rules/` is not, because oh-my-pi has no Claude rule provider.

### Lifecycle terms

**Always-on context**:
Content the harness injects into every conversation's system prompt without the model having to ask for it. Claude Code does this for `~/.claude/rules/*.md` automatically. oh-my-pi does it only for rules with `alwaysApply: true` frontmatter — which this repo deliberately doesn't use. See **Rulebook** below.

**Rulebook** (oh-my-pi):
oh-my-pi's bucket of rules that are listed in the system prompt by `name + description` and read on demand via `rule://<name>`. Requires `description:` frontmatter. This repo's three rulebook rules (`coding-style`, `testing`, `performance`) live here — the descriptions are written as load-triggers ("Read before writing tests…", "Read when handling user input…") so the model knows when to pull them in. The eight remaining rules in `rules/` are TTSR (below), not rulebook.

**TTSR** (oh-my-pi — time-traveling stream rules):
oh-my-pi's mid-stream rule injection: a regex match against the model's output aborts the stream, injects the rule body as a `<system-reminder>`, and retries from the same token. Configured via `condition:` frontmatter (plus optional `scope:`). **Retired in this repo (ADR-0012):** every TTSR enforcement rule was migrated into the **guard core** (command and write-**content** detection), so no `rules/*.md` carries `condition:` frontmatter any more. Kept here as historical vocabulary for ADR-0003 (which ADR-0012 supersedes).

**Hook** (oh-my-pi — pre/post-tool TS modules):
TS/JS modules at `harnesses/omp/hooks/{pre,post}/*.ts` (symlinked to `~/.omp/agent/hooks/{pre,post}/`). Subscribe to oh-my-pi runtime events via the `HookAPI` from `@oh-my-pi/pi-coding-agent/extensibility/hooks`. Pre-hooks fire on `tool_call` (before execution) and can return `{ block, reason }` to refuse the call. Post-hooks fire on `tool_result` (after execution) and can return `{ content, details, isError }` to mutate what the model sees. Unlike TTSR, hooks see **structured tool input** (`event.input.command`, `event.input.path`), so they catch what regex on stream text can't: process substitution (`bash <(…)`), find-exec, interpreter wrappers (`python -c "os.system(…)"`). Hooks can also **mutate output** (TTSR can only block). This repo uses hooks for input-bound patterns where TTSR's regex has known bypasses, and for output redaction (which TTSR fundamentally can't do). See [`hooks-replace-ttsr-for-input-bound-patterns`](docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md). Distinct from oh-my-pi **extensions** (`harnesses/omp/extensions/`), which use the same event API but can also register commands, tools, and renderers — extensions are the superset, hooks are the narrower event-handler surface.

### Harness-modularity & guardrail terms

**Harness module**:
A self-contained directory holding everything specific to one harness — its runtime config file(s), its guardrail adapter, and a declaration of which **config root** it installs into and which shared categories it consumes. Adding or removing a harness is adding or removing one module; `install.sh` is a generic loop over the modules that exist.
_Avoid_: harness folder, plugin, per-harness block.

**Config root**:
The home-directory location a harness reads its config from — `~/.claude/`, `~/.omp/agent/`, `~/.pi/agent/`. Each config root is owned **exclusively** by one harness module.

**Cross-discovery**:
A harness's built-in scavenging of *another* harness's config root (e.g. oh-my-pi reading `~/.claude/skills/` via its Claude provider at priority 80). Deliberately **disabled** in this repo (`skills.enableClaudeUser: false`, etc.) so that sharing is push-only — every harness sees only what `install.sh` mirrored into its own root.
_Avoid_: fallback, delegation, scavenge.

**Isolation invariant**:
The guarantee that each harness sees only its own module's files plus the curated shared set — never content leaked from a sibling harness. Upheld by disabling cross-discovery and verified by the **isolation test**. Distinct from **sandboxing** (runtime VM isolation of a harness process — a different, orthogonal concept).

**Isolation test**:
The check asserting each config root contains only `{its module's files} ∪ {the curated shared set}` — no symlink resolving into a sibling harness's directory, cross-discovery flags off. A leak fails CI.

**Advisory rule**:
A `rules/*.md` file that is pure guidance the model reads — shares verbatim across harnesses like a skill, with no mechanical enforcement. After the guardrail consolidation (ADR-0012), **`rules/` is advisory-only**: `coding-style`, `testing`, `performance`, `git-commit`, `mise`, and `security` (its non-blockable principles). All *enforcement* moved to the **guard core**. Distinct from a **Guardrail policy**.
_Avoid_: rule (unqualified — the bare word hides the advisory-vs-guardrail split).

**Rule projection**:
How the advisory rules reach a given harness — there is **no single shared path** (ADR-0013); each harness gets the rules through the mechanism that fits its context model. Three exist: **Claude** auto-injects the rules dir always-on; **oh-my-pi** lists them in its native **rulebook** and loads them lazily via `rule://<name>` (ADR-0002); **pi** reads a **generated concatenation** (see **Rule concatenation**). Enforcement, by contrast, travels one shared path (the **guard core**), not by projection.

**Rule concatenation** (pi):
pi has no native rulebook and reads only a single always-on instruction file, so the advisory rules are joined into one committed file (`harnesses/pi/advisory-rules.md`), symlinked as pi's global `~/.pi/agent/AGENTS.md` (install-once, live through the symlink; the source carries a distinct name so it isn't confused with — or gitignored as — a stray `AGENTS.md`). A **drift-check** in the gate regenerates it from `rules/*.md` and fails if the committed copy is stale, so a forgotten regeneration can't be committed. (ADR-0013)

**Context file** (pi):
A file pi loads at startup: global `~/.pi/agent/AGENTS.md` (always-on instructions) and `SYSTEM.md` (replaces the system prompt), plus project `AGENTS.md`/`CLAUDE.md` discovered walking up from cwd. pi reads single files, not a directory, and does not expand `@import` references — which is why **Rule concatenation** is necessary. The module's generated `harnesses/pi/advisory-rules.md` (installed as pi's `AGENTS.md`) is distinct from the repo-root `AGENTS.md` (this repo's authoring contract), which is never installed into a config root.

**Guardrail policy**:
A security/safety constraint with a *shared intent* but a *per-harness enforcement mechanism* (e.g. never read secrets, never write a secret literal, no curl-pipe-to-shell, no cloud teardown). Recorded once in the **policy registry** and projected into each harness via its adapter.
_Avoid_: rule, permission (a permission is the native allow/deny knob a policy may *project onto*, not the canonical constraint itself).

**Policy registry**:
The canonical, harness-neutral list of guardrail policies in `shared/policy-registry.ts` — one entry per policy: an **ID**, intent, enforcement metadata (check kind: `command` / `path` / `content` / `secret`; `floor` flag), and boundary examples (a violating `example` + benign `counterExample`). The single source of truth for *what* must be enforced.

**Guard core**:
The shared TypeScript module implementing the *detection* logic for guardrail policies over a normalized tool call (`tool`, `command`, `path`, and write **`content`**) — `isSecretPath`, `isCurlPipeShell`, `isHardcodedSecret`, …, imported unchanged by every harness whose hook API can run it. The single source of truth for *how* a policy is detected.
_Avoid_: hook (a harness's event surface), matcher.

**Enforcement tier** (a.k.a. **adapter archetype**):
The classification of a harness by *how* it can enforce policies — **A** programmable (runs the guard core in-process: pi, oh-my-pi), **B** command-hook (runs the guard core via an external command + shim: Claude Code), **C** declarative (static allow/deny patterns only), **D** sandbox (environment isolation, e.g. Gondolin), **E** guidance (prompt text only). A new harness maps to one or more tiers; each tier has a reusable adapter.
_Avoid_: harness type.

**Coverage matrix**:
The policy × harness table produced by the **conformance test**, recording how each policy is enforced — or an explicitly acknowledged gap — for each harness.

**Conformance test**:
The check that every harness covers the **mandatory policy floor** and that every other policy is either enforced or has an *explicit* (never silent) gap in the coverage matrix.

**Mandatory policy floor**:
The subset of guardrail policies every harness must enforce (at tier A/B/C/D strength) to be admitted to the fleet — e.g. `no-secret-access`. A harness that cannot meet the floor must be **sandboxed or rejected**.
_Avoid_: baseline.

### Build-pipeline terms

**Pipeline skill**:
One of the seven skills the `/build` orchestrator drives through its four phases — `build`, `grill`, `prd`, `tasks`, `implement`, `implement-coach`, `visual-explainer`. Distinct from a **standalone skill** (`refactor`, `improve-codebase`, `handoff`, `pickup`, `prototype`) which is invoked on its own, never orchestrated by `/build`.
_Avoid_: phase (a phase is a stage of the pipeline; a pipeline skill is the unit that runs it).

**Progressive disclosure**:
The skill-authoring convention where `SKILL.md` is a thin entry point that defers heavy detail to `references/*.md` files read on demand, instead of one monolithic file. Detail used by more than one skill lives in a global `skills/shared/references/` directory and is imported by relative path rather than duplicated (e.g. `prd`/`tasks`/`implement` read `../shared/references/build-pipeline.md`); detail used by a single skill lives in that skill's own `references/`.
_Avoid_: lazy loading (overloaded with the oh-my-pi rulebook's on-demand `rule://` mechanism).

**Feature directory**:
The per-build-run home for feature artifacts: `docs/features/<YYYYMMDD-HHMM>-<slug>/`, holding `prd.md`/`prd.html`, `tasks.md`/`tasks.html`, and `diff-review.html`. Project-wide artifacts (`CONTEXT.md`, `docs/adr/`) live at the repo root and accrete across runs.
_Avoid_: `docs/claude/` (the former Claude-specific name, replaced by the harness-neutral `docs/features/` — see [`adopt-docs-features-over-docs-claude`](docs/adr/0007-adopt-docs-features-over-docs-claude.md)).

## Example dialogue

> **Dev**: I want to add `/refactor` so it works in both harnesses.
> **Expert**: That's a slash command, not a skill. Drop a markdown file at `commands/refactor.md` with frontmatter and a body template. `install.sh` symlinks it into `~/.claude/commands/` and — for oh-my-pi — either we symlink it to `~/.omp/agent/commands/` for native priority, or we rely on oh-my-pi's `.claude` fallback at priority 80. The skill/command duality matters: if a `skills/refactor/` directory already exists, the command file gets skipped for Claude Code (to avoid registering both as `/refactor`).
>
> **Dev**: And if I want the testing rule to be picked up by oh-my-pi too?
> **Expert**: Rules with no frontmatter are silently dropped by oh-my-pi's rulebook pipeline. Add a `description:` to `rules/testing.md` — phrased as a load-trigger like "Read before writing tests…" — and oh-my-pi lists it in the rulebook for the model to pull in on demand. We deliberately skip `alwaysApply: true` for context economy; oh-my-pi's context-tax-per-turn would be high if every rule injected wholesale. The frontmatter is harmless to Claude Code.
>
> **Dev**: And `security.md` — I never want any harness reading my `.env`. Same deal, just symlink it?
> **Expert**: No — that's the split. `security.md` as *guidance* is an **advisory rule** and shares fine. But "never read secrets" as an *enforced* constraint is a **guardrail policy**: it gets an ID in the **policy registry**, the detection lives once in the **guard core** (`isSecretPath`), and each **harness module** wires that core in via its **enforcement tier** — pi and oh-my-pi run it in-process (tier A), Claude runs it through a stdin/stdout shim (tier B). The **conformance test** then proves every harness covers it, because `no-secret-access` is in the **mandatory policy floor**.
>
> **Dev**: But oh-my-pi already reads `~/.claude/skills/` for free. Doesn't it just pick up Claude's security setup too?
> **Expert**: That "for free" is exactly the pollution we close. That's **cross-discovery**, and we disable it (`enableClaudeUser: false`) so sharing is push-only — every **config root** sees only what `install.sh` mirrored into it. The **isolation test** fails CI if anything under `~/.omp/agent/` resolves back into `claude/`. Sharing is a curated set we push, never something a harness scavenges.
