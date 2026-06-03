# Authoring contract for this repo

*(This is `AGENTS.md` — read at the repo root by Claude Code, OpenCode, and omp. It is force-tracked past the global `AGENTS.md` gitignore because defining cross-harness agent config is this repo's whole purpose.)*

This repo is one source of truth for multiple AI coding harnesses (Claude
Code, OpenCode, omp). Primitives are authored **once** under `skills/`,
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

| Primitive | Authored at | Claude Code | OpenCode | omp |
|---|---|---|---|---|
| **Skill** | `skills/<name>/SKILL.md` | yes — `~/.claude/skills` | yes — reads `~/.claude/skills` | yes — `~/.omp/agent/skills` |
| **Command** | `commands/<name>.md` | yes — `~/.claude/commands` (skipped if a skill of the same name exists, to avoid a duplicate `/name`) | yes — `~/.config/opencode/commands` | yes — `~/.omp/agent/commands` |
| **Agent** | `agents/<name>.md` | yes — `~/.claude/agents` | **no — not supported** | yes — `~/.omp/agent/agents` |
| **Rule** | `rules/<name>.md` | yes — `~/.claude/rules` (auto-injected each turn) | **no — not loaded** | yes — `~/.omp/agent/rules` (rulebook / TTSR / hook) |

Implications:

- A capability that must work on **all three** harnesses is a **skill** (plus,
  optionally, a thin command wrapper) — never an agent, since **agents do not
  run on OpenCode**. Reviews here are agents by design (`code-reviewer`,
  `database-reviewer`, `refactor-cleaner`, `doc-updater`), so they are
  Claude+omp only.
- `commands/` is a Claude-Code-originated slash-command concept that we mirror
  to all three. A thin command for an existing skill should just say
  *"Load the `<skill>` skill, then …: `$ARGUMENTS`"*.
- **Do not shadow a Claude built-in.** `/simplify` and `/fact-check` are
  Claude Code built-ins, so our own versions are the skills `code-cleaner`
  and `fact-checker` — never named `simplify`/`fact-check`.
- Reference another skill's assets by relative path
  (`../<skill>/references/<file>.md`); the gate resolves these links.

## Rules — pick the right omp mechanism

Claude Code injects every `rules/*.md` as always-on context; OpenCode ignores
rules; omp has **three buckets — choose exactly one per rule**:

- **Rulebook** (advisory, lazy) — `description:` frontmatter, no `condition:`.
  omp lists it by name+description and the model pulls it in on demand via
  `rule://<name>`. Phrase the description as a load-trigger ("Read before
  writing tests…"). Used for `coding-style`, `testing`, `performance`.
  (ADR-0002)
- **TTSR** (time-traveling stream rules) — `condition:` regex (optional
  `scope:`). omp aborts the stream on a match, injects the rule, retries. Use
  for content patterns and bash-command patterns regex can't be tricked on. A
  rule with `condition:` is TTSR-only, not also rulebook. (ADR-0003)
- **Hook** (structured, input-bound) — TS modules at `omp/hooks/{pre,post}/*.ts`
  (`pre/guard-*.ts`, `post/redact-*.ts`) importing `HookAPI` from
  `@oh-my-pi/pi-coding-agent/extensibility/hooks`. Use when you need parsed
  tool input (paths, command) — catches what stream regex can't (process
  substitution, find-exec, interpreter wrappers) and can mutate output.
  (ADR-0006)

## Permissions

`claude/settings.json` is the source of truth. Edit it, then run
`scripts/sync-permissions.py` (the pre-commit hook runs it too) to regenerate
`opencode/opencode.jsonc`. omp maps coarsely to tier-based approval.
(ADR-0004, ADR-0005)

## Quick recipes

- **New skill** → copy the shape of a thin existing one; `SKILL.md` plus a
  `references/` only for genuine bulk; shared detail goes in
  `skills/shared/references/`. Run the gate.
- **New command for an existing skill** → thin wrapper (see above).
- **New rule** → decide rulebook vs TTSR vs hook, then add the matching
  frontmatter / file.
- **Rename or move a reference** → update every link; the gate fails if a
  `references/…md` link no longer resolves.
