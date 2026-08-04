# Authoring contract for this repo

*(This is `AGENTS.md` — read at the repo root by Claude Code and pi. It is force-tracked past the global `AGENTS.md` gitignore because defining cross-harness agent config is this repo's whole purpose.)*

This repo is one source of truth for two AI coding harnesses — Claude Code and pi.
Primitives are authored **once** under `skills/`, `agents/`, and `rules/`, and `install.sh` fans them out to each harness.
`CONTEXT.md` is the glossary; `docs/adr/` records *why* each decision was made; **this file is the prescriptive "how to add or edit things" contract.**
Follow it for every edit or addition.

> `rules/*.md` is **not** the place for these conventions — those files ship
> into the user's target projects and govern coding *there*, not authoring
> *here*. Repo-authoring conventions live in this file.

## Enforcement — run before every commit

`make test` is the gate (run `make` to list targets). It runs four categories —
`test/content` (the authoring contract), `test/install` (install + harness
modules), `test/guard` (the guard-core/conformance bun suite), and `test/meta`
(the self-test that proves the checks catch planted errors). It runs
automatically in the pre-commit hook (`.githooks/pre-commit`) and **must stay
green**. `test/content` enforces: frontmatter (`name`/`description`/agent
tools), that **every `references/…md` link in a SKILL.md resolves**, ADR
numeric identifiers are unique, duplicate command wrappers stay retired, no
Claude-centric phrasing, no stale stubs, and the required workflow phrases for
each `/build` phase; `test/install` enforces the harness manifest contract and
isolation. Review-artifact browser evidence requires Firefox and must not be
silently skipped. If you relocate content, update the gate in the same change —
never weaken it to pass.

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
  reference stays a single `SKILL.md` — there is nothing to disclose
  progressively. Don't force a split. (Domain *knowledge* that should be
  applied, not just read, belongs in a consultant agent instead — see
  `api-designer` / `frontend-architect`, converted from former leaf
  reference skills.)
- If a skill has a human `guide.html`, keep it consistent with `SKILL.md`.
- Feature artifacts live in `docs/features/<YYYYMMDD-HHMM>-<slug>/` — never
  `docs/claude/` (harness-neutral; ADR-0007).
- Artifacts that require pipeline feedback or approval are canonical semantic
  HTML reviewed through `review-artifact`; do not add Markdown companions or
  hidden duplicate models (ADR-0018).

## Which primitive, and which harnesses consume it

| Primitive | Authored at | Claude Code | pi |
|---|---|---|---|
| **Skill** | `skills/<name>/SKILL.md` | `~/.claude/skills` | `~/.pi/agent/skills` |
| **Agent** | `agents/<name>.md` | `~/.claude/agents` | `~/.pi/agent/agents` |
| **Rule** | `rules/<name>.md` | canonical source (on demand) | canonical source (on demand) |
| **Standalone CLI** | `skills/<name>/bin/` | harness-independent | harness-independent |

Implications:

- **Skills** and **agents** reach both harnesses, so choose by *nature*, not coverage: a **skill** is a workflow the main session follows; an **agent** is a spawned sub-task invoked via the harness's subagent tool.
  Change review separates the read-only `change-reviewer` from the mutating `change-fixer`, consults `database-reviewer` conditionally, and uses `fact-checker` for build artifacts; implementation owns only the `refactorer` hygiene sweep.
- Skills are the only file-backed user workflow primitive.
  Claude registers each skill directly as `/<name>`, while pi registers it as `/skill:<name>` and can also select it from its description.
  Do not duplicate skills as prompt or command wrappers.
- **Do not shadow a Claude built-in.** `/simplify` and `/fact-check` are
  Claude Code built-ins, so our own equivalents carry different names — the
  `refactorer` hygiene sweep (not `simplify`) and the `fact-checker` agent
  (not `fact-check`).
- Reference another skill's assets by relative path
  (`../<skill>/references/<file>.md`); the gate resolves these links.
- A standalone executable that drives a skill lives with that skill, reuses its
  canonical workflow, and is linked into `~/.local/bin/` by `install.sh`.
  It must not fork a second copy of the workflow contract.

## Rules are advisory; guardrails are enforced

`rules/*.md` is **advisory only** (ADR-0012).
Detailed rules are on demand: Claude and pi read the canonical `~/.dotfiles/ai/rules/` files.
A small shared bootstrap (`harness-system-prompt.md`, ADR-0016) is always loaded by both harnesses; it holds only critical constraints, the shared location, and load triggers.
Agent `Project Rules` sections contain only bare rule names.
Phrase every rule `description:` as a load trigger ("Read before writing tests…").
**No rule carries `condition:`/`scope:`** — the retired TTSR frontmatter; the gate fails any rule that re-introduces it.

**Enforcement** (mechanically *blocking* a dangerous tool call) is **not** a
rule. It lives once in the **guard core** as a guardrail policy (see Permissions)
and projects into every harness through its adapter. So: to *advise*, write a
rule; to *block*, add a policy + detector to `shared/` — never both.

## Permissions

`harnesses/claude/settings.json` is Claude Code's permission source of truth — edit it directly.
Cross-harness **guardrail policies** — never read or write secrets, no curl-pipe-to-shell, no broad rm/chmod, no sudo, no cloud teardown / deploy / db-mutation / dd-to-disk, no destructive git, no shell-redirect writes — are defined once in `shared/policy-registry.ts` + `shared/guard-core.ts`.
The core inspects `command`, `path`, and write `content` and projects into each harness through the tier-A pi extension (`harnesses/pi/extensions/guard-policies.ts`) and the tier-B Claude shim (`harnesses/claude/hooks/guard.ts`).
A conformance test enforces the mandatory floor on every harness; an isolation test forbids cross-harness pollution.
(ADR-0011; all enforcement consolidated here per ADR-0012, which retired TTSR.)

## Quick recipes

- **New skill** → copy the shape of a thin existing one; `SKILL.md` plus a
  `references/` only for genuine bulk; shared detail goes in
  `skills/shared/references/`. Run the gate.
- **New rule** → it's advisory metadata: add `description:` frontmatter, no
  `condition:`. To *enforce* (block) something, add a guardrail policy +
  detector to the guard core instead — not a rule.
- **Rename or move a reference** → update every link; the gate fails if a
  `references/…md` link no longer resolves.
