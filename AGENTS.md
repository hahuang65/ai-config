# Authoring contract for this repo

*(This is `AGENTS.md` — read at the repo root by Claude Code and oh-my-pi. It is force-tracked past the global `AGENTS.md` gitignore because defining cross-harness agent config is this repo's whole purpose.)*

This repo is one source of truth for two AI coding harnesses — Claude Code
and oh-my-pi. Primitives are authored **once** under `skills/`,
`commands/`, `agents/`, `rules/`, and `install.sh` fans them out to each
harness. `CONTEXT.md` is the glossary; `docs/adr/` records *why* each
decision was made; **this file is the prescriptive "how to add or edit
things" contract.** Follow it for every edit or addition.

> `rules/*.md` is **not** the place for these conventions — those files ship
> into the user's target projects and govern coding *there*, not authoring
> *here*. Repo-authoring conventions live in this file.

## Enforcement — run before every commit

`bash scripts/test-pipeline.sh` is the gate. It runs automatically in the
pre-commit hook (`.githooks/pre-commit`) and **must stay green**. It enforces:
frontmatter (`name`/`description`/agent tools), that **every `references/…md`
link in a SKILL.md resolves**, no Claude-centric phrasing, no stale stubs,
the harness install targets, and the required workflow phrases for each
`/build` phase. `scripts/test-pipeline-self-test.sh` guards the gate itself.
If you relocate content, update the gate in the same change — never weaken it
to pass.

## Progressive disclosure — required for every skill

A skill's `SKILL.md` is loaded into the model's context the moment the skill
activates, so keep it thin and defer detail to references read on demand
(see ADR-0008).

- **`SKILL.md` is a lightweight entry point**: purpose, when-to-use, the
  workflow, and links to its detail — not a monolith.
- **Per-skill detail → `skills/<name>/references/<file>.md`**, linked from
  `SKILL.md`.
- **Detail used by more than one skill → `skills/shared/references/<file>.md`**,
  imported by relative path (`../shared/references/<file>.md`). Single-source
  it and link; never duplicate shared content.
- References are **lowercase-kebab** `.md` (`build-pipeline.md`, not
  `BUILD_PIPELINE.md`).
- `skills/shared/` is **not a skill** (no `SKILL.md`); the gate skips it.
- **Exception:** a leaf reference skill whose entire payload *is* the
  reference (`api-design`, `frontend-patterns`) stays a single `SKILL.md` —
  there is nothing to disclose progressively. Don't force a split.
- If a skill has a human `guide.html`, keep it consistent with `SKILL.md`.
- Feature artifacts live in `docs/features/<YYYYMMDD-HHMM>-<slug>/` — never
  `docs/claude/` (harness-neutral; ADR-0007).

## Which primitive, and which harnesses consume it

| Primitive | Authored at | Claude Code | oh-my-pi |
|---|---|---|---|
| **Skill** | `skills/<name>/SKILL.md` | yes — `~/.claude/skills` | yes — `~/.omp/agent/skills` |
| **Command** | `commands/<name>.md` | yes — `~/.claude/commands` (skipped if a skill of the same name exists, to avoid a duplicate `/name`) | yes — `~/.omp/agent/commands` |
| **Agent** | `agents/<name>.md` | yes — `~/.claude/agents` | yes — `~/.omp/agent/agents` |
| **Rule** | `rules/<name>.md` | yes — `~/.claude/rules` (auto-injected each turn) | yes — `~/.omp/agent/rules` (rulebook / TTSR / hook) |

Implications:

- Both **skills** and **agents** reach both harnesses (Claude Code and oh-my-pi),
  so choose by *nature*, not coverage: a **skill** is a workflow the main
  session follows; an **agent** is a spawned sub-task invoked via the Task /
  `task` tool. The review chain uses agents (`code-reviewer`,
  `database-reviewer`, `refactor-cleaner`, `doc-updater`).
- `commands/` is a Claude-Code-originated slash-command concept that we mirror
  to both harnesses. A thin command for an existing skill should just say
  *"Load the `<skill>` skill, then …: `$ARGUMENTS`"*.
- **Do not shadow a Claude built-in.** `/simplify` and `/fact-check` are
  Claude Code built-ins, so our own versions are the skills `code-cleaner`
  and `fact-checker` — never named `simplify`/`fact-check`.
- Reference another skill's assets by relative path
  (`../<skill>/references/<file>.md`); the gate resolves these links.

## Rules — pick the right oh-my-pi mechanism

Claude Code injects every `rules/*.md` as always-on context; oh-my-pi has **three
buckets — choose exactly one per rule**:

- **Rulebook** (advisory, lazy) — `description:` frontmatter, no `condition:`.
  oh-my-pi lists it by name+description and the model pulls it in on demand via
  `rule://<name>`. Phrase the description as a load-trigger ("Read before
  writing tests…"). Used for `coding-style`, `testing`, `performance`.
  (ADR-0002)
- **TTSR** (time-traveling stream rules) — `condition:` regex (optional
  `scope:`). oh-my-pi aborts the stream on a match, injects the rule, retries. Use
  for content patterns and bash-command patterns regex can't be tricked on. A
  rule with `condition:` is TTSR-only, not also rulebook. (ADR-0003)
- **Hook** (structured, input-bound) — TS modules at `harnesses/omp/hooks/{pre,post}/*.ts`
  (`pre/guard-*.ts`, `post/redact-*.ts`) importing `HookAPI` from
  `@oh-my-pi/pi-coding-agent/extensibility/hooks`. Use when you need parsed
  tool input (paths, command) — catches what stream regex can't (process
  substitution, find-exec, interpreter wrappers) and can mutate output.
  (ADR-0006)

## Permissions

`harnesses/claude/settings.json` is Claude Code's permission source of truth —
edit it directly. `harnesses/omp/config.yml` is hand-authored: oh-my-pi uses
tier-based approval (`approvalMode` + per-tool overrides). Cross-harness
**guardrail policies** (never read secrets, no force-push, no broad rm, no sudo,
no curl-pipe-to-shell) are defined once in `policies/` + `shared/guard-core.ts`
and projected into each harness via its adapter — the tier-A in-process hook
(`harnesses/omp/hooks/pre/guard-policies.ts`) and the tier-B Claude shim
(`harnesses/claude/hooks/guard.ts`). A conformance test enforces the mandatory
floor on every harness; an isolation test forbids cross-harness pollution.
(ADR-0004 superseded in part by ADR-0010, ADR-0011)

## Quick recipes

- **New skill** → copy the shape of a thin existing one; `SKILL.md` plus a
  `references/` only for genuine bulk; shared detail goes in
  `skills/shared/references/`. Run the gate.
- **New command for an existing skill** → thin wrapper (see above).
- **New rule** → decide rulebook vs TTSR vs hook, then add the matching
  frontmatter / file.
- **Rename or move a reference** → update every link; the gate fails if a
  `references/…md` link no longer resolves.
