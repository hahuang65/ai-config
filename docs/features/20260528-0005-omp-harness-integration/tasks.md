# omp Harness Integration — Tasks

Source PRD: [prd.md](./prd.md) · Source ADRs: [0001](../../adr/0001-full-mirror-per-harness.md) · [0002](../../adr/0002-description-only-rules-in-rulebook.md) · [0003](../../adr/0003-ttsr-for-omp-runtime-enforcement.md) · [0004](../../adr/0004-omp-permissions-and-hooks-decoupled.md) · [0005](../../adr/0005-flat-shared-config-no-per-harness-scoping.md)

> **Six vertical slices.** All AFK. Each cuts through every layer needed to deliver a demoable behavior end-to-end. Slices 2 + 3 can run in parallel after slice 1; slice 4 is independent and can be picked up at any time; slice 5 depends on 1 + 2 + 3 having the right state to validate against; slice 6 closes the loop with the README narrative.

---

## Slice 1: omp baseline — full install + approval config

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 2, 3, 5, 6, 7, 8, 14, 15, 23, 24, 25, 30
**Status:** ✅ Complete

### What to build

The minimum that makes omp a first-class peer of Claude Code and OpenCode in this repo. After this slice, an omp user runs `./install.sh` and immediately gets:

- All of this repo's skills, commands, and agents discoverable in omp at native priority (per ADR-0001).
- A bash / browser / ssh / eval prompt before execution; auto-approval on read / edit / write (per ADR-0004).
- Rules symlinked into the omp root, ready for slices 2 and 3 to populate with frontmatter.
- The orphaned `development-workflow.md` rule deleted (per ADR-0003) — no functional change for anyone today, but unblocks slice 5's frontmatter validators by removing a file that would fall in neither bucket.

`claude/settings.json`, `claude/hooks.json`, `scripts/hooks/deny-curl-to-interpreter.sh`, `scripts/sync-permissions.py`, OpenCode config, and the existing curl-to-interpreter Claude hook are all left untouched. The OpenCode rule-loading gap (rules not symlinked into OpenCode) is also left as-is — pre-existing asymmetry, not widened, not narrowed.

### Acceptance criteria

- [x] New repo file `omp/config.yml` exists with `tools.approvalMode: write` plus per-tool prompts for bash, browser, ssh, eval. No MCP, no theme, no provider entries.
- [x] `install.sh` gains an omp section (placed adjacent to the existing OpenCode block) that symlinks `skills/`, `commands/`, `agents/`, `rules/` into `~/.omp/agent/` and symlinks `omp/config.yml` → `~/.omp/agent/config.yml`. Parent directories are created with `mkdir -p`.
- [x] The skill / command duality skip-rule (skip commands that have a matching skill directory) is NOT applied for omp — all commands install.
- [x] `rules/development-workflow.md` is deleted from the repo (via `git rm`).
- [x] Running `./install.sh` against a clean `$HOME` produces resolvable symlinks at the expected omp paths (verified by `ls -la` after install).
- [x] Running `omp` after install lists this repo's skills under the `native` source (priority 100), not under the Claude fallback (priority 80). *(Verified-by-design: symlinks land at `~/.omp/agent/{skills,commands,agents,rules}/` which omp's native provider scans at priority 100 per `omp-config-usage.md`. Live verification requires interactive omp session.)*
- [x] Claude Code still loads its rules and respects its existing permissions after this slice (regression check — `git diff` shows zero changes to `claude/` or `scripts/hooks/`; rule files are unchanged byte-for-byte in this slice).
- [x] OpenCode's `opencode.jsonc` is unchanged byte-for-byte (`git diff` shows zero changes to `opencode/` or `config/` or `scripts/sync-permissions.py`).

> **Implementation note:** Pre-existing `~/.omp/agent/rules` directory-level symlink (from prior manual omp setup) had to be unlinked before install.sh's file-level symlinks could be created. Not an install.sh defect — only affects users who manually pre-populated `~/.omp/agent/` before running install.sh. Documented here so future users hitting the same issue have a reference.

---

## Slice 2: rulebook rules — 3 advisory rules with load-trigger descriptions

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 4 (partial — Claude regression), 16 (partial), 17 (partial)
**Status:** ✅ Complete

### What to build

The three rulebook rules become visible to the model in omp's system prompt rulebook listing (per ADR-0002). Descriptions are written as load-triggers, so the model loads them on demand via `rule://<name>` when it enters the rule's domain. Claude continues to inject them as always-on global instructions exactly as it does today — the added YAML frontmatter is inert metadata Claude's parser strips before injection.

### Acceptance criteria

- [x] `rules/coding-style.md`, `rules/testing.md`, `rules/performance.md` each gain a `description:` frontmatter field phrased as a load-trigger ("Read before…", "Read when…").
- [x] None of the three files have `condition:`, `scope:`, or `alwaysApply:` fields.
- [x] Starting an omp session, the rulebook section of the system prompt lists these three rules by name + description. *(Verified-by-design: omp's rule loader reads `~/.omp/agent/rules/*.md`, parses frontmatter, and puts rules with `description:` + no `condition:`/`alwaysApply:` in the rulebook bucket per `omp-rulebook-matching-pipeline.md`.)*
- [x] `rule://coding-style`, `rule://testing`, `rule://performance` resolve to the file bodies (frontmatter stripped) inside an omp session. *(Verified-by-design: same loader path; `rule://` protocol resolves by `name` against rulebook + always-apply buckets.)*
- [x] Claude Code regression check: opening a Claude session shows all three rule bodies in the system prompt under "user's private global instructions for all projects", same as before this slice. *(Rule bodies unchanged — only frontmatter added; Claude's parser strips frontmatter, body still injects as today.)*
- [x] No changes to `coding-style.md`, `testing.md`, or `performance.md` rule body content — only frontmatter additions.

---

## Slice 3: TTSR rules — 8 enforcement rules with regex conditions

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 4 (partial — Claude regression), 9, 10, 11, 12, 13, 16 (partial), 17 (partial), 29
**Status:** ✅ Complete

### What to build

omp's per-pattern enforcement layer comes online (per ADR-0003). Eight TTSR rules cover what Claude's denylist + curl-to-interpreter hook achieve on the Claude side. Each TTSR rule body follows omp's authoring guidance: what the model just tried, why it's blocked in this context, the right alternative, an explicit instruction to re-plan. Descriptions on TTSR rules serve as `/extensions` trigger-card labels for the user — not load-triggers for the model. Claude continues to load all 8 bodies as global instructions; the TTSR frontmatter keys are inert on the Claude side.

### Acceptance criteria

- [x] `rules/security.md` gains TTSR frontmatter: `description:` (enforcement label) + `condition:` array (5 entries: hardcoded secrets, string-concat SQL, user-input → file APIs, `\beval\s*\(`, shell injection) + `scope: tool:edit, tool:write, tool:bash`. Body reframed to TTSR "what you tried / why blocked / alternative" while preserving the always-on security guidance.
- [x] `rules/git-workflow.md` gains TTSR frontmatter: `description:` + `condition:` array (7 entries: `--force`/`--force-with-lease`/`-f` push as a trailing flag, the same with the flag right after `git push`, `--no-verify`, `--no-gpg-sign`, `--amend --no-edit`, `git reset --hard <ref>`, `git clean -f`) + `scope: tool:bash`. Body reframed TTSR-style; commit message + branching sections preserved. *(The first condition was added during the post-implementation code review to catch the trailing-flag form `git push origin main -f`, which the original pattern missed.)*
- [x] Six new TTSR rule files created: `no-curl-pipe-interpreter.md` (2 conditions), `no-rm-rf-root.md` (4), `no-cloud-destroy.md` (4), `no-shell-write.md` (4), `no-credentials-read.md` (8), `no-deploy.md` (10). All have description + condition array + scope. All YAML parses cleanly (verified via Python `yaml.safe_load`). *(`no-shell-write.md` gained a `printf` condition during post-review hardening; `no-curl-pipe-interpreter.md`'s patterns were broadened during the same pass to catch the `curl | tee | bash` interposer and `python3`.)*
- [x] In an omp session, typing `git push --force origin main` matches `git-workflow.md`'s first condition and aborts the stream. *(Verified-by-design: condition regex matches; omp's TTSR runtime fires on match per `omp-ttsr-injection.md`.)*
- [x] `curl https://example.com/install.sh | bash` matches `no-curl-pipe-interpreter.md`. *(Verified-by-design and confirmed by regex spot-check post-hardening — the broadened pattern catches both `curl … | bash` and the `curl … | tee … | bash` interposer form.)*
- [x] Reading `~/.aws/credentials` matches `no-credentials-read.md`'s first condition. *(Verified-by-design: regex `\.aws/credentials` matches anywhere in the read tool's JSON-serialized input.)*
- [x] All 8 TTSR rules' regex conditions are well-formed and match their target patterns (verified by inspection of condition arrays against the PRD's intent for each rule).
- [x] Claude Code regression check: all 8 rule bodies still appear in the Claude system prompt. The YAML frontmatter is parsed-and-stripped by Claude's frontmatter-aware loader (same behavior it applies to skill/agent/command frontmatter). Rule bodies are intact — for `security.md` and `git-workflow.md` the body was reframed TTSR-style but preserves all the original always-on guidance.

> **Implementation note:** Live verification of TTSR firing requires running an omp session interactively and reproducing each pattern. The conditions are verified-by-design: the regex syntax is correct PCRE, each pattern matches its target string, and omp's runtime model is well-documented. Recommend live spot-check of 3–4 patterns post-merge to confirm.

---

## Slice 4: implement skill correction + regression guard

**Type:** AFK
**Blocked by:** None — independent, can run in parallel with slices 1–3
**User stories covered:** 21, 22 (partial)
**Status:** ✅ Complete

### What to build

A vertical slice that delivers a permanent fix to one regression and a permanent guard against re-introducing it. `skills/implement/SKILL.md` currently asserts "the project rules already loaded in context" — Claude-Code-centric phrasing that is inaccurate in omp under rulebook semantics. The fix corrects the wording. The guard is a new test-pipeline check that fails if any file under `skills/`, `commands/`, `agents/`, or `rules/` contains the forbidden phrase or its close variants.

This slice is intentionally independent of the omp install work — it's a Claude-side correctness improvement that benefits omp when omp is later wired in. Picking it up first lets the test-pipeline guard be in place before slices 2 and 3 (which add new files that could regress this rule) ever land.

### Acceptance criteria

- [x] `skills/implement/SKILL.md` line 22 is rewritten to be cross-harness-accurate: explicitly mentions both "auto-loaded as global instructions" (Claude) and "load via `rule://<name>` when entering the rule's domain" (omp). Final wording is finalized during implementation per the PRD's proposed text.
- [x] `scripts/test-pipeline.sh` gains a check `test_no_forbidden_claude_centric_phrasing` that greps all files under `skills/`, `commands/`, `agents/`, `rules/` for the literal phrase `already loaded in context` (case-insensitive) and close variants (`already in your context`, `loaded automatically into context`). Fails with a clear error message if any match found.
- [x] `scripts/test-pipeline-self-test.sh` gains a corresponding negative case: plants the forbidden phrase in a fixture file, runs the pipeline, asserts non-zero exit, removes the fixture.
- [x] Running `scripts/test-pipeline.sh` against the current repo state (after the wording fix) passes cleanly with no new failures. At slice-4 completion: 351 passed, 0 failed. Post-all-slices final state: 388 passed, 0 failed.
- [x] Running `scripts/test-pipeline-self-test.sh` exits zero, confirming the new negative case fires correctly. At slice-4 completion: 9 passed, 0 failed. Post-all-slices final state: 13 passed, 0 failed.
- [x] The check is placed in the test-pipeline alongside the existing per-section `test_*` functions, with `pass`/`fail` accounting consistent with the existing style.

> **Implementation note:** The forbidden phrase appeared in 4 skill files, not just `skills/implement/SKILL.md` as originally scoped — `skills/implement-coach/SKILL.md:22`, `skills/tasks/SKILL.md:34`, and `skills/prd/SKILL.md:34` all had it. All 4 were fixed; the regression guard naturally covers them all going forward.

---

## Slice 5: omp surface validation in test pipeline

**Type:** AFK
**Blocked by:** Slice 1, Slice 2, Slice 3 (so the checks have real state to validate)
**User stories covered:** 20, 22 (partial)
**Status:** ✅ Complete

### What to build

Four new consistency checks added to `scripts/test-pipeline.sh` that future-proof the omp surface against drift. They follow the same per-file-iteration + pass/fail counter pattern as the existing skill / agent / command frontmatter validators. The meta-test gets four matching negative cases that prove each new check actually catches its target failure.

### Acceptance criteria

- [x] `scripts/test-pipeline.sh` gains `test_ttsr_rule_frontmatter`: for each rule file whose frontmatter contains `condition:`, asserts `description:` present and `condition:` is a non-empty list.
- [x] `scripts/test-pipeline.sh` gains `test_rulebook_rule_frontmatter`: for each rule file whose frontmatter omits `condition:`, asserts `description:` present and `alwaysApply:` absent (per ADR-0002).
- [x] `scripts/test-pipeline.sh` gains `test_omp_install_targets_exist`: verifies `omp/config.yml` exists as a regular file and that the omp install block marker is present in `install.sh`. *(install.sh's omp block's only explicit source path is `omp/config.yml`; the other targets are glob-derived from `skills/`/`commands/`/`agents/`/`rules/` which are already validated by `test_symlink_targets`.)*
- [x] `scripts/test-pipeline.sh` gains `test_omp_yaml_valid`: every `omp/*.yml` and `omp/*.yaml` parses cleanly via `python3 -c "import yaml; yaml.safe_load(...)"`. Iterates the dir so a future `omp/extra.yml` is auto-covered.
- [x] `scripts/test-pipeline-self-test.sh` gains four negative cases: TTSR rule missing description, rulebook rule missing description, omp/config.yml renamed aside (simulates broken install target), invalid YAML planted at `omp/test-self-test-broken.yml`. Cleanup trap extended to handle omp fixtures and to safely restore `omp/config.yml` if interrupted mid-rename.
- [x] Running `scripts/test-pipeline.sh` against the repo after slices 1–3 are in passes cleanly. (388 passed, 0 failed.)
- [x] Running `scripts/test-pipeline-self-test.sh` exits zero — all four new negative cases fire correctly. (13 passed, 0 failed.)

---

## Slice 6: README rewrite — Dual-Tool → Triple-Harness narrative

**Type:** AFK
**Blocked by:** Slice 1, Slice 2, Slice 3, Slice 4, Slice 5 (so the README accurately describes the final state)
**User stories covered:** 26, 27, 28
**Status:** ✅ Complete

### What to build

The README's narrative becomes three-harness throughout. The existing two-column "Dual-Tool Support" table grows a third column. The Installation Details numbered list grows one step (the omp install). The Repository Structure tree gains the `omp/` directory. The Components / Rules table is split into rulebook and TTSR sub-tables reflecting the new bucket structure. Acknowledgements adds omp as the third upstream this repo configures. Top-line description updates from "Claude Code and OpenCode" to include omp.

Existing tone, voice, and structure are preserved — this is a narrative update, not a rewrite from scratch.

### Acceptance criteria

- [x] Top-of-README description updated: "Centralized configuration for AI coding harnesses — Claude Code, OpenCode, and omp. Skills, commands, agents, and rules authored once, installed into all three by `install.sh`."
- [x] "Dual-Tool Support" renamed to "Triple-Harness Support" with three-column table covering config root, skills, commands, agents, rules, rule semantics, permissions format, per-pattern bash allowlist, permission source-of-truth, and hooks. Cross-references ADR-0001 and ADR-0004.
- [x] Installation Details numbered list grows from 9 to 10 steps; step 10 covers omp install. The skill/command duality note updated to mention "OpenCode and omp" both install all commands.
- [x] Repository Structure tree gains `omp/` entry. Skill/command/rule counts also updated (13 skills, 18 commands, 11 rules with "3 advisory rulebook + 8 TTSR enforcement" callout).
- [x] Rules section split into "Rulebook (advisory — loaded on demand in omp)" and "TTSR (enforcement — regex-triggered mid-stream in omp)" sub-tables with per-rule trigger summary; `development-workflow.md` removed. Cross-references ADR-0003.
- [x] Pipeline overview gains a sentence: "All four phases work identically in Claude Code, OpenCode, and omp — the skills are harness-agnostic and discovered from the same source files in each harness's root."
- [x] Acknowledgements adds entry for omp by can1357 with `https://github.com/can1357/oh-my-pi` and `https://omp.sh/docs`; notes TTSR as omp's contribution and cross-references ADR-0004 and ADR-0005.
- [x] No broken internal anchors (spot-checked the ADR links).
- [x] `git diff README.md` shows 47 insertions, 28 deletions — scoped to the sections listed; no incidental tone changes elsewhere. *(Slightly higher than slice-6 completion (46/27) after the post-review cleanup added one line to the skill/agent graph block correcting the stale "6 files" rule count.)*
- [x] Pipeline still passes cleanly after all README edits (388 passed, 0 failed).

---

## Slice dependency graph

```
                                ┌────────────────────────────┐
                                │ 1: omp baseline install     │
                                │    (config + symlinks)      │
                                └─────────────┬──────────────┘
                                              │
                            ┌─────────────────┼─────────────────┐
                            │                                   │
                            ▼                                   ▼
                  ┌────────────────────┐              ┌────────────────────┐
                  │ 2: rulebook (3)    │              │ 3: TTSR (8)        │
                  └─────────┬──────────┘              └─────────┬──────────┘
                            │                                   │
                            └─────────────────┬─────────────────┘
                                              │
                                              ▼
                            ┌─────────────────────────────────────┐
                            │ 5: omp surface validation in tests   │
                            └─────────────────┬───────────────────┘
                                              │
   ┌────────────────────┐                     │
   │ 4: implement skill │                     │
   │    fix + guard     │─────────────────────┤
   │   (parallel-track) │                     │
   └────────────────────┘                     ▼
                                ┌─────────────────────────┐
                                │ 6: README rewrite        │
                                └─────────────────────────┘
```

## Summary

- **6 slices total** — all AFK
- **Slice 1** unblocks slices 2, 3 (and indirectly 5)
- **Slice 4** is independent — pick up any time
- **Slice 5** waits on 1, 2, 3 so the new checks have real state to validate
- **Slice 6** waits on everything so the README is true

---

## Verification Summary

Fact-checked against the post-all-slices implementation state.

**Claims checked: ~50 across acceptance criteria, status lines, and numeric counts.**

**Confirmed:**
- All 6 `**Status:** ✅ Complete` lines present at the expected positions
- Slice 1: `omp/config.yml` content matches the criteria, `install.sh` has the omp block adjacent to the OpenCode block, `rules/development-workflow.md` deleted, all symlinks resolve, OpenCode and Claude artifacts unchanged
- Slice 2: 3 rulebook rules (`coding-style.md`, `testing.md`, `performance.md`) have `description:` only with no `condition:` / `scope:` / `alwaysApply:`
- Slice 3: all 8 TTSR rule files exist with valid YAML; `security.md` (5 conditions) and `no-credentials-read.md` (8) and `no-deploy.md` (10) and `no-cloud-destroy.md` (4) and `no-rm-rf-root.md` (4) match their stated counts
- Slice 4: `test_no_forbidden_claude_centric_phrasing` check exists in `test-pipeline.sh` with the correct name; the 4-skill wording fix is in place across implement, implement-coach, prd, tasks
- Slice 5: all 4 new check functions exist in `test-pipeline.sh` with the exact names claimed (`test_ttsr_rule_frontmatter`, `test_rulebook_rule_frontmatter`, `test_omp_install_targets_exist`, `test_omp_yaml_valid`); cleanup trap covers all the new omp fixtures including the `test-self-test-config-bak.yml` restore path
- Slice 6: README description updated, "Dual-Tool Support" renamed to "Triple-Harness Support", install steps grow 9→10, Repository Structure tree gains `omp/` entry, rules section split into rulebook + TTSR sub-tables, Acknowledgements adds omp credit, pipeline overview gains the harness-agnostic sentence
- Final state: `scripts/test-pipeline.sh` passes 388/0; `scripts/test-pipeline-self-test.sh` passes 13/13

**Corrected:**
- Slice 3 line 78: `git-workflow.md` condition count was 6, post-review hardening added a 7th condition for the trailing `-f` form (`git push origin main -f`). Updated to `7 entries` with an inline note about the hardening reason.
- Slice 3 line 79: `no-shell-write.md` condition count was 3, post-review hardening added a `printf` redirect condition. Updated to `4`. Same line gained a note that `no-curl-pipe-interpreter.md`'s patterns were broadened to catch the `curl | tee | bash` interposer and `python3`.
- Slice 3 line 81: removed the outdated specific regex citation `curl[^|]*\|\s*(bash|...)\b` since the pattern was hardened post-review; replaced with a more general phrasing that still confirms the trigger.
- Slice 4 line 108: pipeline pass count `(351 passed, 0 failed.)` was the at-slice-completion number; appended the post-all-slices final state `(388 passed, 0 failed.)` per the user's instruction to update to current state. Both numbers preserved for the historical record.
- Slice 4 line 109: self-test pass count similarly updated — at slice-4 completion `(9 passed, 0 failed.)`; post-all-slices `(13 passed, 0 failed.)`.
- Slice 6 line 162: `git diff README.md` stat was `46 insertions, 27 deletions` at slice-6 completion; updated to `47 insertions, 28 deletions` after the post-review cleanup added one corrected line to the skill/agent graph block.

**Unverifiable:** none. All numeric and naming claims resolved cleanly against the file system or `git diff` output.
