# omp Harness Integration — PRD

Integrate **omp** (oh-my-pi, by can1357) as a third terminal AI coding harness alongside Claude Code and OpenCode, served by a single source of configuration in this repo.

> **Prerequisite reading.** This PRD is the transcription of a grilling session. The authoritative decisions and the rationale for them live in:
> - [`CONTEXT.md`](../../../CONTEXT.md) — vocabulary glossary
> - [`docs/adr/0001-full-mirror-per-harness.md`](../../adr/0001-full-mirror-per-harness.md) — install model
> - [`docs/adr/0002-description-only-rules-in-rulebook.md`](../../adr/0002-description-only-rules-in-rulebook.md) — rulebook strategy
> - [`docs/adr/0003-ttsr-for-omp-runtime-enforcement.md`](../../adr/0003-ttsr-for-omp-runtime-enforcement.md) — TTSR strategy + dropping development-workflow rule
> - [`docs/adr/0004-omp-permissions-and-hooks-decoupled.md`](../../adr/0004-omp-permissions-and-hooks-decoupled.md) — permissions and hooks strategy
> - [`docs/adr/0005-flat-shared-config-no-per-harness-scoping.md`](../../adr/0005-flat-shared-config-no-per-harness-scoping.md) — flat layout
>
> The PRD does not override or relitigate these. When a reader has a "why?" question, the ADRs are the answer of record.

---

## Problem Statement

The repo's README claims to be **"centralized configuration for AI coding assistants"** but in practice it serves only Claude Code and OpenCode. omp is a third terminal AI coding agent — same shape as Claude Code (subagents, plan mode, slash commands, hooks, MCP, native tools) with a Rust core and its own configuration model. Today, an omp user starting from this repo gets zero of its skills, rules, agents, commands, or safety configuration.

The repo's stated goal of **"a single configuration that can power any arbitrary AI harness"** is aspirational, not literal. To make it literal, omp must be wired in as a first-class peer to Claude and OpenCode.

The integration must accommodate omp's structural differences without compromising the existing Claude/OpenCode experience: omp's permission model is tier-based (`approvalMode: read|write|exec`) with no per-pattern allowlist; omp's rule discovery has its own native bucketing (rulebook vs always-apply vs TTSR) but no Claude rule provider; omp's hook system wants TS/JS modules, not shell scripts. The integration must also be shaped so that a fourth harness later is a copy-paste exercise, not a redesign.

---

## Solution

Add omp as a third harness via the same **"configure once, install everywhere"** pattern this repo already applies to Claude and OpenCode:

- Symlink every shared primitive (skill, command, rule, agent) into `~/.omp/agent/` from `install.sh`, exactly mirroring the existing Claude/OpenCode install loops. Full mirror, not discovery-based fallback. (ADR-0001)
- Hand-author a small `omp/config.yml` (~15 lines) covering omp's tier-based approval model. No permission-sync extension — Claude's per-pattern allowlist has no omp equivalent. (ADR-0004)
- Restructure the rule library into two buckets: a **3-file rulebook** (advisory; loadable on demand via `rule://`) and an **8-file TTSR set** (regex-triggered mid-stream enforcement). TTSR is omp's per-pattern enforcement layer, replacing what Claude's denylist + `deny-curl-to-interpreter.sh` hook achieve on the Claude side. Delete the orphaned `development-workflow.md` rule (redundant with `/build` itself). (ADR-0002, ADR-0003)
- Keep the existing Claude artifacts (settings.json, hooks.json, the curl hook script) and the OpenCode permission sync **untouched**. Claude users see no behavior change.
- Tweak one line in `skills/implement/SKILL.md` so its Claude-centric "already loaded in context" phrasing becomes cross-harness-accurate. Add a test-pipeline regression guard so the phrase can never sneak back in.
- Extend `scripts/test-pipeline.sh` so a future maintainer adding a 4th harness — or modifying any of the three current ones — gets immediate feedback on config drift, malformed rule frontmatter, broken install symlinks, or invalid omp YAML. Add corresponding negative cases to the meta-test.
- Rewrite the README from "Dual-Tool Support" to "Triple-Harness Support" with a three-column comparison table and an omp install-step section.

---

## User Stories

1. As a **repo maintainer**, I want omp to be installable from this repo so its stated "any harness" goal becomes literal rather than aspirational.
2. As a **user running `install.sh` after pulling latest**, I want my omp configuration installed alongside Claude and OpenCode so a single command bootstraps every harness I use.
3. As a **user installing on a new machine**, I want `install.sh` to create `~/.omp/agent/` (the user-level root with the literal `agent` subfolder) and symlink the right files into it without me having to know omp's directory convention.
4. As a **Claude Code user**, I want nothing about my existing experience to change after this integration — my rules still load, my permissions still apply, my hooks still fire.
5. As an **OpenCode user**, I want nothing about my existing experience to change after this integration — my synced permissions still work, my skills and commands still resolve.
6. As an **omp user starting a session**, I want this repo's 13 skills surfaced in my omp system prompt by name + description so I can invoke them with `/grill`, `/build`, `/refactor`, etc.
7. As an **omp user invoking `/build`**, I want the same multi-phase workflow Claude users get — grill → PRD → tasks → implement — without per-harness deviation.
8. As an **omp user spawning a subagent via the `task` tool**, I want this repo's seven agents (architect, code-reviewer, tdd-guide, refactor-cleaner, database-reviewer, doc-updater, refactorer) available by name.
9. As an **omp user**, I want this repo's TTSR rules to fire automatically when I try to do something dangerous — no setup, no config edits, no per-rule enabling.
10. As an **omp user about to write `git push --force`**, I want the stream to abort mid-token and an inline reminder to explain why this is blocked and what to do instead.
11. As an **omp user about to write `curl https://… | bash`**, I want TTSR to fire — same effective protection Claude's hook gives on the Claude side.
12. As an **omp user about to have the `read` tool open `~/.aws/credentials`**, I want TTSR to fire and block the read before any secret material reaches the model's context.
13. As an **omp user about to run `make deploy`, `terraform apply`, or `wrangler deploy`**, I want TTSR to interrupt — deployments must be human-initiated, not agent-initiated.
14. As an **omp user invoking bash**, I want to be prompted before execution — omp's `approvalMode: write` default is the right friction for exec-tier tools.
15. As an **omp user editing or writing a file**, I want no prompt — file mutations are auto-approved under `approvalMode: write`.
16. As a **developer browsing `rules/` in the repo**, I want each rule's role to be obvious from its frontmatter at a glance: a rulebook rule has only `description:`; a TTSR rule has `description:` + `condition:` + `scope:`.
17. As a **developer writing a new rule**, I want clear conventions: rulebook descriptions are load-triggers (`"Read before …"`), TTSR descriptions are enforcement labels (`"Block …"`).
18. As a **developer reading `CONTEXT.md`**, I want canonical definitions of `Harness`, `Skill`, `Rulebook`, `TTSR`, and the harness-specific config dirs in one place — not scattered across the README.
19. As a **developer reading `docs/adr/`**, I want the rationale for the five integration decisions without spelunking through commit history.
20. As a **developer running `scripts/test-pipeline.sh`**, I want it to fail loudly if a TTSR rule is missing its `condition:`, if a rulebook rule accidentally gains a `condition:`, if a symlink target in the omp install block doesn't exist on disk, or if `omp/config.yml` doesn't parse as YAML.
21. As a **developer running the test pipeline**, I want it to fail if any file under `skills/`, `commands/`, `agents/`, or `rules/` contains the Claude-centric phrase "already loaded in context" — that phrase is false on omp and will regress as new skills get written if it isn't guarded.
22. As a **maintainer of `scripts/test-pipeline-self-test.sh`**, I want negative test cases that prove each new check actually catches the failure it claims to catch.
23. As the **author of `scripts/sync-permissions.py`**, I want the script to stay a Claude ↔ OpenCode bridge — not extended to omp, where the per-pattern format has no equivalent — so the script's promise stays honest.
24. As the **author of `scripts/hooks/deny-curl-to-interpreter.sh`**, I want the shell hook to stay Claude-only — no TS port for omp's hook API, since TTSR covers the same surface.
25. As a **future maintainer adding a 4th harness**, I want the `install.sh` omp block to be small and self-contained so I can copy-paste it as a starting point and adjust the paths / config format.
26. As a **user reading the README**, I want a single Triple-Harness Support table comparing Claude / OpenCode / omp across config location, skills, commands, agents, rules, permissions, and hooks — so I understand what each harness gets and what it doesn't.
27. As a **user reading the README's pipeline overview**, I want to know that `/build`'s phases all work in omp the same way they work in Claude.
28. As a **user reading the README's "Acknowledgements"**, I want omp credited as the third upstream this repo configures.
29. As an **omp user encountering a TTSR injection mid-stream**, I want the reminder to tell me what I just tried, why it's blocked here, and the right alternative — not a generic "rule fired" notification.
30. As an **omp user**, I want my omp-internal personal config (custom model providers via `models.yml`, themes, statusline, keybindings) to stay user-personal — not centralized in this repo.

---

## Implementation Decisions

### Install model

- Per ADR-0001, `install.sh` gets a new section for omp that symlinks `skills/`, `commands/`, `rules/`, and `agents/` into `~/.omp/agent/`, plus symlinks `omp/config.yml` to `~/.omp/agent/config.yml`. Order: after the OpenCode block, before the summary. The script's per-section style (named heading, `green` echo, `dim` per-symlink confirmation) is preserved.
- The user-level omp root requires the literal `agent` subdirectory: `~/.omp/agent/`, not `~/.omp/`. `install.sh` creates the parent dirs before symlinking.
- The **skill / command duality rule** (skip commands that have a matching skill directory, applied for Claude Code today to avoid duplicate slash-command registration) does **not** apply to omp. All commands install for omp, same as for OpenCode.
- Rule symlink direction is unchanged: source-of-truth lives at `<repo>/rules/<name>.md`; install.sh creates symlinks at `~/.claude/rules/`, `~/.omp/agent/rules/`. OpenCode rule symlinks are not added — that's a pre-existing OpenCode gap this PRD does not widen but also does not fix.

### Rule library restructure (per ADR-0003)

Three rulebook files (description-only frontmatter; descriptions written as load-triggers):

- `coding-style.md`
- `testing.md`
- `performance.md`

Eight TTSR files (description + condition array + scope):

- `security.md` — migrated from rulebook intent to TTSR with multi-condition coverage (hardcoded secrets, string-concat SQL, user input → file APIs, `eval`, shell injection)
- `git-workflow.md` — migrated from rulebook intent to TTSR with multi-condition coverage (force-push, hook-skip flags, broad `git reset --hard`, `git clean -f`)
- `no-curl-pipe-interpreter.md` — `curl … | bash|sh|zsh|python|node|ruby|perl|sudo` and `wget` equivalent
- `no-rm-rf-root.md` — `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`, `rm -rf *`, `rm -rf .`, `rm -rf ..`
- `no-cloud-destroy.md` — AWS destructive (`delete-*`, `terminate-*`), Terraform (`apply`, `destroy`), gcloud delete, kubectl delete
- `no-shell-write.md` — `echo > file` / `cat > file` / `tee` to file (forces use of the Write/Edit tools, which carry their own per-file approval)
- `no-credentials-read.md` — paths matching `.aws/credentials`, `.kube/config`, `.ssh/id_*`, `.netrc`, `.pgpass`, `.npmrc … _authToken`, `.secrets.`, and any file/path-segment literally named `credentials`
- `no-deploy.md` — `make {apply,deploy*,push*}`, `npm/yarn/pnpm run deploy`, `cap … deploy`, `fly deploy`, `vercel --prod`, `wrangler deploy`, `sls/serverless deploy`, `kubectl apply`, `helm install|upgrade`

One file deleted:

- `development-workflow.md` — orphaned in the cross-reference graph (zero agents reference it), redundant with the `/build` skill itself. README pipeline overview is the canonical version.

Each TTSR rule body follows the Box::leak template documented at omp.sh/docs/ttsr: what the model just tried, why it's blocked in this context, the right alternative, an explicit instruction to re-plan. Descriptions on TTSR rules serve as `/extensions` trigger-card labels, not load-triggers — the audience is the user looking at why the rule fired, not the model deciding whether to load it.

### omp runtime config (per ADR-0004)

New hand-authored file: `omp/config.yml`. Symlinked to `~/.omp/agent/config.yml`. v1 content:

```yaml
# omp/config.yml — symlinked to ~/.omp/agent/config.yml
tools:
  approvalMode: write          # auto-approves read/write; prompts for exec
  approval:
    bash: prompt               # explicit (matches `write` mode's exec-tier prompt)
    browser: prompt
    ssh: prompt
    eval: prompt
```

No MCP servers, no provider/model entries, no statusline, no theme. Those are either user-personal (models.yml, themes) or out of scope for v1 (MCP).

The Claude per-pattern allowlist (`Bash(rspec *)`, `mise x -- rspec *`, etc. — 89 Bash entries among 114 total allow entries) does not translate. omp users will see a `bash` prompt on every routine command — the accepted friction trade-off per ADR-0004.

### Claude-side guarantees

These files get **zero edits**:

- `claude/settings.json` (Claude permissions stay as-is)
- `claude/hooks.json` (curl-pipe hook stays)
- `claude/statusline.sh`
- `scripts/hooks/deny-curl-to-interpreter.sh` (still Claude's safety net; not ported to omp per ADR-0004)
- `scripts/sync-permissions.py` (stays a Claude ↔ OpenCode bridge per ADR-0004)
- `opencode/opencode.jsonc` (auto-generated; sync script unchanged)
- `opencode/tui.json`
- `config/opencode-only.json`

### Implement skill correction

`skills/implement/SKILL.md:22` currently says:

> Comply with the project rules already loaded in context (coding-style, testing, security, performance, git-workflow).

This is Claude-centric — in omp under rulebook semantics, the rules are listed in the system prompt but not pre-injected. Replacement phrasing (final wording can be tightened during implementation):

> Comply with the project rules: coding-style, testing, security, performance, git-workflow. In Claude Code these are auto-loaded as global instructions; in omp, load via `rule://<name>` when entering the rule's domain (or rely on the relevant TTSR rule firing). The skill itself — not just the agents it invokes — must follow them.

Regression-guarded by the new test-pipeline check described below.

### Test pipeline extensions (`scripts/test-pipeline.sh`)

Five new checks, following the existing per-file iteration + pass/fail counter pattern:

- **TTSR frontmatter shape**: for each rule file whose frontmatter contains `condition:`, assert `description:` is also present, `condition:` is a non-empty list of strings, and `scope:` (if present) is a string or comma-list.
- **Rulebook frontmatter shape**: for each rule file whose frontmatter omits `condition:`, assert `description:` is present and that `condition:` and `alwaysApply:` are absent.
- **omp install targets exist**: parse the omp install block in `install.sh`; every symlink line's source path must resolve to an existing repo file.
- **omp config YAML valid**: `omp/config.yml` parses as YAML.
- **Forbidden Claude-centric phrasing**: no file under `skills/`, `commands/`, `agents/`, `rules/` contains the literal phrase `already loaded in context` or close variants (`already in your context`, `loaded automatically into context`). The check matches case-insensitively.

Corresponding negative cases in `scripts/test-pipeline-self-test.sh`, one per new check, that build broken fixtures and verify the pipeline catches them.

### README rewrite

- Top-line description: "Centralized configuration for AI coding assistants — Claude Code, OpenCode, and omp."
- "Dual-Tool Support" section becomes "Triple-Harness Support" with a three-column comparison table across config location, skills, commands, agents, rules, permissions format, permission source-of-truth, and hooks.
- Installation Details: the nine numbered steps grow to ten (the omp install step goes after the OpenCode config block, adjacent to it for readability).
- Repository Structure: add the `omp/` directory entry alongside `claude/` and `opencode/`.
- Rules table (in Components): split the rules row into a rulebook sub-table and a TTSR sub-table reflecting the new bucket structure.
- Acknowledgements: add an omp upstream credit (https://github.com/can1357/oh-my-pi, docs at https://omp.sh/docs) and note the TTSR concept as omp's contribution to the cross-harness shape.

### What's NOT changed

- No new skills, commands, or agents. The integration is plumbing; existing primitives now work in three harnesses instead of two.
- No `rules/omp/`, `rules/claude/`, `rules/shared/` directory split — per ADR-0005, the flat layout is preserved. Per-harness directories exist only for the runtime config files themselves (`claude/`, `opencode/`, `omp/`).
- No automated tests for `install.sh` itself — today's script has none for Claude/OpenCode either; adding them is out of scope.
- No migration script for existing users — `ln -sf` is idempotent; re-running `install.sh` after this lands adds the omp symlinks without disturbing existing Claude/OpenCode ones.

---

## Testing Decisions

**What makes a good test in this codebase**: tests run against config artifacts (markdown files, JSON, YAML, shell scripts), not application code. Good tests verify that files have the right **shape** — frontmatter keys present, JSON/YAML validates, symlinks resolve to existing files. Per `rules/testing.md`, tests must verify external behavior (file structure visible to the harnesses), not internal implementation. Each test should be independently runnable, with shared setup factored into helpers. The existing `test-pipeline.sh` style uses per-section `test_*` functions with a `pass`/`fail` counter and exit code — new tests follow that exact pattern.

**Modules with automated tests**:

- **Rule library (module 2)** — covered by the new TTSR / rulebook frontmatter checks.
- **omp runtime config (module 3)** — covered by the YAML validity check.
- **Test pipeline extensions (module 4)** — covered by the new negative cases in `test-pipeline-self-test.sh`. The meta-test pattern is: build an intentionally broken fixture, run `test-pipeline.sh` against it, assert non-zero exit.
- **Implement skill correction (module 5)** — covered by the forbidden-phrasing check, which acts as both an immediate verification (the fix passes) and a permanent regression guard (the phrase can't reappear in any AI-readable file).

**Modules without automated tests** (verified manually or by review):

- **Install pipeline (module 1)** — current install.sh has no automated tests for Claude/OpenCode either. Verified by running `install.sh` against a clean `$HOME` and inspecting that every expected symlink exists and resolves. Adding install.sh testing infrastructure is out of scope.
- **README rewrite (module 6)** — content review.

**Prior art in the repo**:

- `scripts/test-pipeline.sh` already validates frontmatter shape for skills (requires `name:`, `description:`) and agents (requires `name:`, `description:`, `tools:`). The new TTSR / rulebook frontmatter checks follow the same per-file iteration + extracted helper pattern.
- `scripts/test-pipeline-self-test.sh` already verifies that the pipeline catches malformed skills, agents, and commands by creating broken fixtures. The new negative cases for TTSR / rulebook / install-target / YAML / forbidden-phrasing checks plug into the existing fixture-build harness.

**One assertion per test** is the norm — each new check is its own `test_*` function; each new negative case is its own self-test entry. Shared setup (e.g. parsing rule frontmatter) goes in helpers next to the existing `extract_frontmatter` helper.

---

## Out of Scope

- **MCP server config in `omp/config.yml`.** omp supports MCP servers via `config.yml`; today's Claude `settings.json` has no MCP entries, so v1 adds none. Future work if/when the user wants centralized MCP servers.
- **omp model/provider config.** `~/.omp/agent/models.yml` (custom providers, fallback chains, path-scoped roles, round-robin credentials) is user-personal config, not repo-managed. Users configure their own providers.
- **omp themes, statusline, keybindings, TUI config.** User-personal. Repo does not ship these.
- **OpenCode rules-loading gap fix.** Today OpenCode does not load rules. This PRD does not fix that pre-existing asymmetry — only Claude and omp consume the `rules/` directory.
- **Porting `deny-curl-to-interpreter.sh` to TypeScript for omp.** Not done — TTSR's `no-curl-pipe-interpreter.md` covers it. The Claude shell hook stays. (ADR-0004)
- **Extending `sync-permissions.py` to omp.** Not done — Claude's per-pattern format has no omp equivalent. (ADR-0004)
- **Installing the omp binary itself.** This PRD configures omp; it assumes the user has installed omp via `bun install -g @oh-my-pi/pi-coding-agent`, `curl -fsSL https://omp.sh/install | sh`, or their preferred method.
- **Per-harness rule / skill / command / agent scoping.** All primitives stay in the flat top-level directories. (ADR-0005)
- **A 4th harness install step.** Out of scope. ADR-0005 documents the principle for future addition; the install.sh omp block serves as the template.
- **Editing or relocating the legacy `example/` directory.** Untouched.

---

## Further Notes

- **Date of decision context.** The grilling session and all five ADRs were created in this single session. Future revisits should re-read the ADRs first — they capture the why; the PRD captures the what.
- **Acknowledgement target.** omp by can1357, https://github.com/can1357/oh-my-pi, docs at https://omp.sh/docs. The TTSR concept (mid-stream regex injection with retry) and the YAML-based extensions/hooks/skills model are omp's contributions to the cross-harness shape. The README's "Acknowledgements" section adds omp as a fifth upstream (after Boris Tane, Matt Pocock, nicobailon/visual-explainer, and affaan-m/everything-claude-code).
- **The 4th-harness hypothesis.** ADR-0005 explicitly addresses how to add a fourth (or fifth) harness later. Mental model: each harness gets a runtime-config directory (`claude/`, `opencode/`, `omp/`, `<future>/`) at the repo root; everything else stays in the flat shared dirs at the top level. The `install.sh` omp block is the copy-paste template.
- **TTSR rules will need tuning post-ship.** Regex patterns are inherently leaky; over-fires (false positives) are easier to fix than under-fires. After living with the rules for some weeks, expect a follow-up `/build` cycle to adjust patterns.
- **Possible follow-up: per-project TTSR rules.** omp's discovery walks ancestor `.omp/rules/` directories, so a per-project repo could add narrower rules (e.g. `no-touch-prod-config.md`). Not in scope for this PRD; mentioned for future planning.
- **Possible follow-up: OpenCode rule loading.** If OpenCode adds a rule loader in a future release, this repo's `rules/` directory becomes immediately useful to OpenCode users without further work — modulo OpenCode's chosen frontmatter conventions.

---

## Verification Summary

Fact-checked against the implementation post-completion of all 6 slices.

**Claims checked: 18 numeric/naming/structural claims across the PRD body.**

**Confirmed (14):**
- 5 ADR files exist with the expected names (lines 7–11)
- 11 rule files split as 3 rulebook + 8 TTSR with the expected names (lines 89–102)
- `rules/development-workflow.md` deleted (line 106)
- 7 agents with the expected names (line 50)
- `omp/config.yml` content matches the snippet shown (lines 114–123)
- `skills/implement/SKILL.md` line 22 contains the new cross-harness phrasing
- 5 new test pipeline checks exist with the expected function names (lines 158–162)
- `tests-pipeline-self-test.sh` cleanup trap covers the new omp fixtures
- `install.sh` has the new omp install block as a self-contained section
- `claude/settings.json`, `claude/hooks.json`, `scripts/hooks/deny-curl-to-interpreter.sh`, `scripts/sync-permissions.py`, `opencode/opencode.jsonc`, `opencode/tui.json`, `config/opencode-only.json` all unchanged
- Out-of-scope items remain out of scope (no MCP entries in `omp/config.yml`, no `models.yml`, no `rules/{omp,claude,shared}/` directory splits, no `install.sh` automated tests)
- All 5 ADR cross-references in the prerequisite-reading block resolve to existing files
- ADR-0005 referenced for per-harness scoping correctly maps to the actual ADR text
- Pipeline + self-test both pass green (388/0 and 13/13 respectively)

**Corrected (4):**
- Line 48: "this repo's nine skills" → "this repo's 13 skills" (actual `ls skills/` count is 13)
- Line 127: "~60 entries" → "89 Bash entries among 114 total allow entries" (actual count from `claude/settings.json`)
- Line 170: "the eight numbered steps grow to nine" → "the nine numbered steps grow to ten" (README install steps were 9 before this work; the new omp step makes it 10)
- Line 227: "omp as a fourth upstream" → "omp as a fifth upstream" (README acknowledgements has 4 prior entries — Boris Tane, Matt Pocock, nicobailon/visual-explainer, affaan-m/everything-claude-code — making omp the 5th)

**Unverifiable (0):** all claims fall in either confirmed or corrected.
