# omp Hooks Migration — PRD

Migrate four TTSR rules with known regex bypasses to omp hooks with structured tool-input parsing, plus add one net-new post-hook for secret redaction.

> **Prerequisite reading.** This PRD transcribes a grilling session whose decisions are recorded in:
> - [`CONTEXT.md`](../../../CONTEXT.md) — vocabulary glossary (now includes `Hook` term distinct from `TTSR`)
> - [`docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md`](../../adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md) — the hook-vs-TTSR decision criteria and migration policy
> - [`docs/adr/0004-omp-permissions-and-hooks-decoupled.md`](../../adr/0004-omp-permissions-and-hooks-decoupled.md) — original ADR whose third pillar ("no hook port to omp") is superseded by ADR-0006; the other two pillars remain
> - [`docs/adr/0001-full-mirror-per-harness.md`](../../adr/0001-full-mirror-per-harness.md), [`0002`](../../adr/0002-description-only-rules-in-rulebook.md), [`0003`](../../adr/0003-ttsr-for-omp-runtime-enforcement.md), [`0005`](../../adr/0005-flat-shared-config-no-per-harness-scoping.md) — unchanged context
>
> The PRD does not relitigate any of these. When a reader has a "why?" question, the ADRs are the answer of record.

---

## Problem Statement

The 12-rule TTSR layer this repo ships covers most dangerous bash patterns adequately, but four of those rules have **known regex bypasses** that markdown-level pattern matching cannot fix:

- `no-curl-pipe-interpreter.md` misses `bash <(curl URL)` and other process-substitution forms
- `no-rm-rf-root.md` misses `find / -delete` (different syntax, same destruction) and patterns reached via process substitution
- `no-credentials-read.md`'s broad regex matches any text mentioning a credential path — including prose, docstrings, and code comments — over-firing as a false-positive and under-firing on shell-quoted variants
- `no-sudo.md`'s `\bsudo\b` matches in stream output but misses `bash <(sudo …)`, `find … -exec sudo …`, `python -c "os.system('sudo …')"`, and other wrapper-via-different-tool shapes

Additionally, omp's TTSR mechanism fundamentally cannot mutate tool output — it can only block. There is no TTSR-shaped solution for **redacting secrets** that appear in `read`, `bash`, or `fetch` tool output (env dumps, `.env` file reads not covered by `guard-credentials`, web responses containing tokens, error messages containing connection strings).

## Solution

Adopt omp's native hook system **selectively** — only for patterns that benefit from structured tool-input parsing — alongside the existing TTSR layer rather than replacing it. Per [ADR-0006](../../adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md):

- Migrate the four bypass-prone TTSR rules to pre-hooks. Each hook reads `event.input.command` (or `event.input.path`) as a structured value, runs a focused check, and returns `{ block: true, reason }` when the pattern fires. Delete the four corresponding TTSR `.md` files.
- Add one net-new post-hook for output redaction across multiple tools and secret patterns, with placeholder skip to avoid noise from docs / fixtures.
- Extend `install.sh` with a parallel install path for `omp/hooks/{pre,post}/*.ts`, alongside the existing `omp/extensions/` symlink loop. Both follow omp's discovery convention.
- Extend the test pipeline with a hook-shape validator that mirrors the existing TTSR / rulebook frontmatter validators in spirit (per-file, narrow assertions).
- Update the README's Triple-Harness Support table to reflect that omp now has hooks; update rule counts.
- Hooks are **omp-only**. Claude Code's existing `claude/hooks.json` + `scripts/hooks/deny-curl-to-interpreter.sh` are byte-for-byte unchanged. OpenCode has no hook system; unchanged.

The eight TTSR rules that don't have known bypasses (`security`, `git-workflow`, `no-cloud-destroy`, `no-shell-write`, `no-deploy`, `no-db-mutation`, `no-dd-disk`, `no-broad-chmod`) stay as-is. They satisfy ADR-0006's TTSR-stays criteria (content-based, or simple-enough regex with no realistic bypass).

---

## User Stories

1. As a **repo maintainer**, I want the four bypass-prone TTSR rules replaced by hooks with structured parsing so that `bash <(curl URL)`, `find / -delete`, `bash <(sudo …)`, and prose-mention false positives no longer happen.
2. As an **omp user**, I want secret patterns in tool output redacted before they reach the LLM provider's context or the conversation transcript, even when the secrets appear in `bash` output (`printenv`, `aws configure list`) or `fetch` output (OAuth responses).
3. As an **omp user about to run `bash <(sudo apt install foo)`**, I want the hook to block — not because the literal string "sudo" appears in the bash command (the prior TTSR rule's mechanism), but because structured parsing of `event.input.command` recognizes the process-substitution wrapper.
4. As an **omp user about to run `find / -delete`**, I want the `guard-rm` hook to block — the prior `no-rm-rf-root` TTSR rule missed this because it only matched the literal `rm` command.
5. As an **omp user whose code happens to include the string `.aws/credentials` in a comment or docstring**, I want the model to be able to mention the path in its output without TTSR over-firing. The hook only fires when a `read` or `edit` tool input parameter resolves to that path, or when a `bash` command actually reads that file.
6. As an **omp user running `printenv` for a legitimate reason** (debugging an env-var-driven config), I want the bash output to flow back to the model with API keys, tokens, and AWS access keys redacted to `[REDACTED]`, while non-secret env vars pass through.
7. As an **omp user reading a README or test fixture that has `API_KEY=YOUR_KEY_HERE`**, I want the placeholder NOT to be redacted (the value is obviously a placeholder, redaction would be noise).
8. As an **omp user about to write `python -c "os.system('sudo …')"`**, I want `guard-sudo` to block — the prior TTSR rule's `\bsudo\b` regex actually catches this in stream output, but only incidentally; the new hook catches it via structured analysis of the python command's `-c` argument string.
9. As a **Claude Code user**, I want my existing experience to be unchanged: rules still load (now 11 instead of 15, but the four removed rule bodies cover patterns Claude already blocks via `claude/settings.json`'s per-pattern denylist), `claude/hooks.json` still fires the curl-to-interpreter shell hook, permissions still apply.
10. As an **OpenCode user**, I want my existing experience to be unchanged. The four migrated rules were never loaded by OpenCode (it doesn't read `rules/`), and OpenCode has no hook system; this work is invisible.
11. As a **developer browsing the repo**, I want it obvious from the directory layout which mechanism handles which kind of pattern: `rules/*.md` for TTSR (content-based + simple-bash), `omp/hooks/pre/*.ts` for pre-tool blockers, `omp/hooks/post/*.ts` for post-tool mutators.
12. As a **developer writing a new safety rule**, I want a decision tree (per ADR-0006's criteria section) that tells me whether the rule belongs as a TTSR `.md` or a hook `.ts`: input-bound + bypass-prone → hook; output-mutation → hook; content the model writes → TTSR; simple bash pattern with no bypass → TTSR.
13. As a **developer running `scripts/test-pipeline.sh`**, I want it to fail loudly if a hook file is missing its `export default function`, isn't importing the `HookAPI` type, or violates the directory naming convention (`pre/` files must be `guard-*`, `post/` files must be `redact-*`).
14. As a **maintainer of `scripts/test-pipeline-self-test.sh`**, I want a negative case proving the new hook-shape check actually catches malformed hooks.
15. As a **developer running `./install.sh`**, I want the omp hooks symlinked into `~/.omp/agent/hooks/{pre,post}/` automatically — no manual omp-side configuration needed.
16. As a **developer maintaining `omp/config.yml`**, I want the file unchanged by this work — hooks live in a separate directory and use a different runtime mechanism than the approval / TTSR settings.
17. As a **reader of the README's Triple-Harness Support table**, I want the omp "Hooks" cell to accurately say "TS/JS modules (5 in `omp/hooks/`)" — not the prior "TS/JS modules (not used)".
18. As an **author of `redact-keys`**, I want a single hook file that handles multiple tools and multiple secret patterns rather than one hook per pattern, because the redaction logic is uniform and the patterns evolve together.
19. As an **author of `guard-credentials`**, I want one hook that handles `read`, `edit`, and `bash` consistently — checking `event.input.path` for the file tools and parsing `event.input.command` for the bash tool — rather than three separate hooks.
20. As a **future reader of `docs/adr/`**, I want to trace the policy evolution: ADR-0004 originally said "no hook port"; ADR-0006 supersedes that pillar with the new criteria; both are preserved with cross-references so the chronology is visible.
21. As an **omp user who hits a hook block**, I want the `reason` field in the returned error to tell me what was blocked and why, in enough detail that I can re-plan the request — the same UX-of-explanation that TTSR's injected rule body provided.

---

## Implementation Decisions

### Hook set (5 files total)

Per ADR-0006's migration policy (conservative: migrate only rules with known bypasses):

- **`guard-rm`** (pre-hook, replaces `no-rm-rf-root.md`). Blocks `rm -rf` against `/`, `~`, `$HOME`, `${HOME}`, `*` (and trailing-slash variants like `~/`, `$HOME/`), plus `find … -delete` / `find … -exec rm …` against the same set, and patterns reached via process substitution. `.` and `..` are deliberately NOT broad targets — `find . -name "*.pyc" -delete` is a common safe cleanup. Broadens the deleted TTSR's coverage via structured argv parsing per ADR-0006 criterion C.
- **`guard-curl-pipe`** (pre-hook, replaces `no-curl-pipe-interpreter.md`). Blocks remote download → interpreter pipelines including the `bash <(curl URL)` process-substitution form and tee-interposer chains.
- **`guard-credentials`** (pre-hook, replaces `no-credentials-read.md`). Blocks reads of credential files across `read`, `edit`, and `bash` tools with per-tool structured input checks — file tools check `event.input.path`, bash checks the parsed argv for any subcommand reading from a credential path. Covers the same 8 path patterns the deleted TTSR covered.
- **`guard-sudo`** (pre-hook, replaces `no-sudo.md`). Blocks any `sudo` invocation including bypass shapes (`bash <(sudo …)`, `find … -exec sudo …`, `python -c "os.system('sudo …')"`).
- **`redact-keys`** (post-hook, net-new). Multi-tool (`read`, `edit`, `bash`), with 5 regex entries covering 11+ secret shapes: a `KEY=value` pattern whose key alternation covers `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `BEARER`, `AUTH(_TOKEN)?`, `ACCESS_KEY`, `PRIVATE_KEY`; plus `Bearer <token>` HTTP-header shape, `AKIA[A-Z0-9]{16}` AWS access key IDs, GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}` classic + `github_pat_[A-Za-z0-9_]{82,}` fine-grained PATs), and JWT three-segment shape (`eyJ…`). Placeholder skip for values matching `xxx`, `your-`, `your_`, `placeholder`, `example`, `redacted`, `<…>` wrappers, repeated dots, all-same-char runs.

### Reference shape for pre-hooks

Captured from the user's grilling input. All four pre-hooks follow this skeleton:

```ts
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function (pi: HookAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;  // or other tool filter
    const cmd = String(event.input.command ?? "");
    if (isDangerous(cmd)) {
      return { block: true, reason: `Refused: ${cmd.slice(0, 80)}` };
    }
  });
}
```

The `isDangerous` predicate is what differs per hook and where the structured-parsing logic lives. Per ADR-0006 the parsing goes beyond regex — naive argv split, detection of `<(…)` and `>(…)` process substitution, `$(…)` and backtick command substitution, `-exec` and `-c` subcommand argument extraction. Each hook owns its own predicate; no shared helper module up front (extract if duplication emerges).

### Reference shape for the post-hook

```ts
export default function (pi: HookAPI) {
  pi.on("tool_result", (event) => {
    if (!REDACT_TOOLS.has(event.toolName) || event.isError) return;
    const content = event.content.map(redactBlock);
    return { content };
  });
}
```

`redactBlock` iterates the secret-pattern array, applies each regex, skips placeholders.

### Install pipeline

`install.sh` gains a section parallel to the existing `omp/extensions/` block:

```bash
mkdir -p "$HOME/.omp/agent/hooks/pre" "$HOME/.omp/agent/hooks/post"
for hook in "$REPO_DIR"/omp/hooks/pre/*.ts; do
  [ -f "$hook" ] || continue
  ln -sf "$hook" "$HOME/.omp/agent/hooks/pre/$(basename "$hook")"
done
# same for post/
```

`omp/hooks/pre/` and `omp/hooks/post/` directories are committed to the repo. The hook files become the first inhabitants.

### Naming convention

- Pre-hook blockers: `guard-<thing>.ts` (e.g., `guard-rm.ts`, `guard-sudo.ts`)
- Post-hook output mutators: `redact-<thing>.ts` (e.g., `redact-keys.ts`)

The convention is enforced by the new test-pipeline check (see Testing Decisions). Future post-hooks that aren't redactors (e.g., `enrich-…`, `wrap-…`) will require extending the convention; current shape only covers redactors.

### Test pipeline extensions

New check `test_omp_hook_shape` in `scripts/test-pipeline.sh`. Per-file iteration over `omp/hooks/{pre,post}/*.ts`. Each file must:

- Contain `export default function` (the hook factory the omp loader expects)
- Import the `HookAPI` type from `@oh-my-pi/pi-coding-agent/extensibility/hooks`
- Follow the naming convention: `pre/guard-*.ts` or `post/redact-*.ts`

Confirmed during the module-sketch checkpoint to be a **distinct** function rather than bundled into the existing `test_omp_install_targets_exist`, matching the per-bucket pattern of the existing `test_ttsr_rule_frontmatter` and `test_rulebook_rule_frontmatter`.

Corresponding negative case in `scripts/test-pipeline-self-test.sh`: plant a fixture hook missing `export default function`, run the pipeline, assert non-zero exit, restore.

### Rule library

The four deleted files:

- `rules/no-rm-rf-root.md`
- `rules/no-curl-pipe-interpreter.md`
- `rules/no-credentials-read.md`
- `rules/no-sudo.md`

The eight surviving rules unchanged:

- Rulebook (3): `coding-style.md`, `testing.md`, `performance.md`
- TTSR (8): `security.md`, `git-workflow.md`, `no-cloud-destroy.md`, `no-shell-write.md`, `no-deploy.md`, `no-db-mutation.md`, `no-dd-disk.md`, `no-broad-chmod.md`

Rule count goes from 15 to 11.

### README rewrite

Targeted updates:

- "Triple-Harness Support" table, omp "Hooks" row: `"TS/JS modules (not used — TTSR covers same surface)"` → `"TS/JS modules (5 hooks in `omp/hooks/`, see ADR-0006)"`
- Repository Structure tree: `rules/    15 rules (3 + 12 TTSR)` → `rules/    11 rules (3 rulebook + 8 TTSR enforcement)`; add `omp/hooks/    5 omp hooks (4 pre + 1 post)` entry
- Skill/Agent graph block: same rule-count update
- Components > Rules section: remove the four migrated rules from the TTSR sub-table; add a brief "Hooks" sub-section pointing at `omp/hooks/` and ADR-0006

### Files explicitly NOT changed

- `claude/settings.json`, `claude/hooks.json`, `claude/statusline.sh` — Claude config untouched
- `scripts/hooks/deny-curl-to-interpreter.sh` — Claude's curl shell hook unchanged
- `scripts/sync-permissions.py` — sync script unchanged
- `opencode/opencode.jsonc`, `opencode/tui.json`, `config/opencode-only.json` — OpenCode unchanged
- `omp/config.yml` — omp runtime config unchanged (hooks live in a separate directory)
- `omp/extensions/` — the extensions directory and its README untouched; this work adds the parallel `omp/hooks/` path, doesn't modify the extensions one

---

## Testing Decisions

**What makes a good test in this codebase**: file-shape validation, not execution. Tests run via `scripts/test-pipeline.sh` against config artifacts (markdown, YAML, shell scripts, and now TypeScript hooks). Each test is a `test_*` function with `pass`/`fail` accounting, mirroring the existing per-section structure. Negative test cases in `test-pipeline-self-test.sh` plant intentionally broken fixtures and verify the pipeline catches them.

**Modules with automated tests**:

- **Pre-hook guards (module 2)** and **post-hook redactor (module 3)** — covered by `test_omp_hook_shape` (validates `export default function`, `HookAPI` import, naming convention).
- **Test pipeline extension (module 4)** — covered by the corresponding self-test negative case.

**Modules without automated tests** (verified manually or by review):

- **Install pipeline (module 1)** — verified by running `./install.sh` and inspecting `~/.omp/agent/hooks/{pre,post}/` for resolvable symlinks. Same approach the existing install.sh extension paths use.
- **README rewrite (module 5)** — content review.

**Live verification** (recommended post-merge, NOT part of automated tests):

- Trigger each pre-hook in an actual omp session by typing the relevant pattern (e.g., `rm -rf ~` for `guard-rm`, `curl URL | bash` for `guard-curl-pipe`, `awk '{}' ~/.aws/credentials` for `guard-credentials`, `sudo apt` for `guard-sudo`) and confirm the stream aborts with the expected `reason`.
- Trigger the post-hook by running a `bash printenv` with a deliberately-set `API_KEY=` env var and confirming the value comes back as `[REDACTED]` in the model's view of the result.
- Verify the bypass-coverage improvements: try `bash <(sudo apt)` (was a TTSR bypass) and confirm `guard-sudo` blocks it; try `find / -delete` (was a TTSR bypass) and confirm `guard-rm` blocks it; mention `.aws/credentials` in prose and confirm `guard-credentials` does NOT fire (the over-firing TTSR is fixed).

**Prior art in the repo**:

- `test_ttsr_rule_frontmatter` and `test_rulebook_rule_frontmatter` in `scripts/test-pipeline.sh` are the structural precedents for `test_omp_hook_shape` — same per-file iteration, same per-section reporting, same self-test negative-case pattern.
- The user-provided hook examples in their grill prompt establish the authoring style; all 5 hooks should follow that skeleton.

---

## Out of Scope

- **bun-based TypeScript test runner.** Executing hooks in isolation with mock event objects would require devDependency on `@oh-my-pi/pi-coding-agent`, a bun-test config, and per-event mocking infra. Inconsistent with this repo's "config artifacts, not application code" testing philosophy. Live verification covers execution-time behavior.
- **Hook execution tests.** No automated way to confirm a hook fires correctly without a running omp session. Confirmed manually via the live-verification checklist above.
- **Hook ports for OpenCode.** OpenCode has no hook system. Permission denylist is the only OpenCode mechanism for this kind of safety, and `sync-permissions.py` already maintains it.
- **Porting Claude's curl shell hook** (`scripts/hooks/deny-curl-to-interpreter.sh`) to TS for omp. The new `omp/hooks/pre/guard-curl-pipe.ts` is independent — it's omp-native code, not a port of the shell script. The shell script continues to serve Claude.
- **Migrating the 8 marginal TTSR rules.** Per ADR-0006's stay-TTSR criteria, the remaining 8 rules have no known bypasses that hook-style structured parsing would fix. Migrating them would be churn without benefit.
- **Adding hooks for fresh dangerous patterns we haven't discussed.** Patterns like `sudo` via shell aliases, container-escape commands, package-manager-as-root flows — out of scope for this PRD. Future safety additions follow the ADR-0006 decision tree (TTSR or hook) on a case-by-case basis.
- **`omp/extensions/` content.** That directory's `README.md` documents that no extensions ship today and stays unchanged — this work is about `omp/hooks/`, a parallel directory with different runtime semantics.
- **Updating prior PRD/tasks docs.** The original integration PRD (`docs/claude/20260528-0005-omp-harness-integration/`) and the previous follow-up (the no-sudo / no-db-mutation / no-dd-disk / no-broad-chmod set) are historical and not edited by this work. The new ADR-0006 supersedes part of ADR-0004 in the way ADRs do — cross-reference, no retroactive edits.

---

## Further Notes

- **The four deleted rule bodies were the model-facing guidance** ("what you tried / why blocked / alternative"). Hooks deliver equivalent guidance via the `reason` string returned to the model as the tool call's error. The `reason` will be shorter than the full TTSR body but more targeted — it includes the specific blocked command snippet (per the user's `guard-rm` example).
- **Claude Code regressions are zero** because the patterns the deleted TTSR rules covered are also blocked by `claude/settings.json`'s per-pattern Bash denylist (`Bash(rm *)`, `Bash(curl * | bash*)`, etc.) plus the curl-to-interpreter shell hook — none of which were touched.
- **OpenCode regressions are zero** because OpenCode doesn't load rule files at all; the four deleted `.md` files were never doing anything for OpenCode users.
- **Live spot-checks before treating any hook as a hardened guard.** Each hook should be exercised in omp at least once post-merge with a representative trigger pattern. The PRD codifies the bypass coverage as an intent; only live testing confirms the implementation.
- **The omp/extensions/ install path built in the prior cycle remains relevant** — it's the symmetric "extensions vs hooks" split per omp's docs. Extensions can do everything hooks do plus register commands/tools/renderers; this work uses the narrower hook surface because it's the right scope for what we're doing (event handlers only). Future work needing command/tool registration would use `omp/extensions/`.
- **Possible follow-up**: a hook authoring helper. If the four pre-hooks end up sharing significant argv-parsing logic (`parseCmd(cmd: string): ParsedCmd` with substitution-aware behavior), extract a shared module under `omp/hooks/_lib/` (underscore-prefixed so the install loop skips it) and have each hook import from it. Defer until duplication is real, not anticipated.
- **Date of decision context.** The grilling session and ADR-0006 were created in the same session as the original integration's grill, but ADR-0006 explicitly supersedes part of ADR-0004 based on bypass behavior observed *after* implementing the original integration. The historical chronology is: original integration → live use revealed bypasses → grill session for this follow-up → ADR-0006 → this PRD.

---

## Verification Summary

Fact-checked against the post-implementation state on 2026-05-28 (all 7 slices complete + post-review HIGH/MEDIUM fixes applied).

**Claims checked: 22 · Confirmed: 19 · Corrected: 3 · Unverifiable: 0**

### Confirmed (no change needed)

- ✅ All 5 hook files exist at the stated paths (`omp/hooks/pre/{guard-rm,guard-curl-pipe,guard-credentials,guard-sudo}.ts`, `omp/hooks/post/redact-keys.ts`).
- ✅ All 4 TTSR `.md` files deleted (`no-rm-rf-root`, `no-curl-pipe-interpreter`, `no-credentials-read`, `no-sudo`).
- ✅ Rule count: 15 → 11. Surviving rules match exactly the 3 rulebook + 8 TTSR enumeration.
- ✅ `test_omp_hook_shape` function exists in `scripts/test-pipeline.sh` (line 617) as a distinct function alongside the prior-art `test_ttsr_rule_frontmatter`, `test_rulebook_rule_frontmatter`, `test_omp_install_targets_exist`.
- ✅ `docs/adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md` exists; ADR-0004's third pillar references it.
- ✅ `guard-credentials` covers 8 credential path patterns (`.aws/credentials`, `.kube/config`, `.ssh/id_*`, `.netrc`, `.pgpass`, `.npmrc`, `.secrets`, generic `credentials`).
- ✅ `guard-credentials` handles `read`, `edit`, and `bash` (user story 19 accurate).
- ✅ `guard-rm` uses structured argv parsing with substitution recursion per ADR-0006 criterion C.
- ✅ Hook reference shapes (pre + post) match the actual code skeleton.
- ✅ Naming convention enforced by pipeline: `pre/guard-*.ts` and `post/redact-*.ts`.
- ✅ Files explicitly NOT changed list (Claude config, OpenCode, `omp/config.yml`, `omp/extensions/`) — all confirmed untouched in spirit by the diff.

### Corrected in place

1. **`guard-rm` broad-target list (Implementation Decisions § Hook set).** PRD originally listed `.` and `..` as broad targets. Actual implementation deliberately omits them (per the post-review fix — over-fired on `find . -name "*.pyc" -delete`). Replaced with the actual target set including `${HOME}` and trailing-slash variants.
2. **`redact-keys` tool list.** PRD originally listed `read, bash, fetch-equivalent`. Actual `REDACT_TOOLS` set in `omp/hooks/post/redact-keys.ts:14` is `{"read", "edit", "bash"}` (no `fetch`; `edit` added during post-review hardening). Corrected to match.
3. **`redact-keys` pattern list.** PRD claimed `gh[pousr]_[A-Za-z0-9]{36}` for GitHub tokens and omitted both the `github_pat_` fine-grained PAT pattern and the JWT pattern. Actual implementation has 5 regex entries — KEY=value (8-arm alternation including `PRIVATE_KEY`), Bearer header, AWS AKIA, GitHub (classic + fine-grained), JWT — plus an extended placeholder skip list (`xxx`, `your-`, `your_`, `placeholder`, `example`, `redacted`, `<…>`, repeated dots, all-same-char). Corrected to enumerate the actual pattern set.

### Notes (scope-of-framing, not corrections)

- Problem Statement line about TTSR being unable to redact `read`, `bash`, or `fetch` output is intentionally broader than the implementation (which covers `read`, `edit`, `bash`). This describes the design space; the chosen scope is in Implementation Decisions. Left as-is.
- User Story 2 mentions `fetch`-output redaction as desirable. The redact-keys hook does not cover `fetch` today; the user story captures intent. Left as-is — future hooks can extend.
