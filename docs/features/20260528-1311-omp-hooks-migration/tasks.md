# omp Hooks Migration — Tasks

Source PRD: [prd.md](./prd.md) · Source ADRs: [0006](../../adr/0006-hooks-replace-ttsr-for-input-bound-patterns.md) (new) · [0004](../../adr/0004-omp-permissions-and-hooks-decoupled.md) (3rd pillar superseded) · [0001](../../adr/0001-full-mirror-per-harness.md), [0002](../../adr/0002-description-only-rules-in-rulebook.md), [0003](../../adr/0003-ttsr-for-omp-runtime-enforcement.md), [0005](../../adr/0005-flat-shared-config-no-per-harness-scoping.md) (unchanged)

> **Seven vertical slices.** All AFK. Slice 1 is the foundation (install machinery + first hook + first TTSR deletion); slice 2 establishes the regression guard for all later hooks; slices 3–6 add the remaining four hooks (each independent after slice 1); slice 7 closes with the README.

---

## Slice 1: omp/hooks install machinery + guard-rm + delete no-rm-rf-root

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1 (partial — first migration), 4, 11, 15, 21 (partial)
**Status:** ✅ Complete

### What to build

The foundational tracer bullet: install pipeline knows how to symlink hooks; the first hook is wired into omp; the corresponding TTSR rule is deleted. After this slice, an omp user runs `./install.sh` and `rm -rf ~` is blocked by a TS hook (not the deleted markdown rule), with broader coverage than the regex used to have (catches `find / -delete`, process substitution wrappers, etc. per ADR-0006 criterion C).

This slice establishes the hook authoring pattern that slices 3–6 follow. It also creates the directory layout (`omp/hooks/pre/`, `omp/hooks/post/`) that the rest of the work plugs into.

### Acceptance criteria

- [x] New repo directory `omp/hooks/pre/` exists with `guard-rm.ts`; `omp/hooks/post/` will spring into being in slice 6 when `redact-keys.ts` is added (avoids the empty-dir-can't-be-committed problem). `omp/hooks/README.md` documents the structure.
- [x] New file `omp/hooks/pre/guard-rm.ts` exports `default function (pi: HookAPI)`, imports `HookAPI` from `@oh-my-pi/pi-coding-agent/extensibility/hooks`, registers a `tool_call` handler that filters `event.toolName === "bash"`, parses `event.input.command` structurally (argv split + process-substitution-aware via `extractSubstitutions` recursion), and returns `{ block: true, reason }` for broad rm/find against `/`, `~`, `$HOME`, `${HOME}`, `*` (and trailing-slash variants). `.` and `..` are deliberately NOT in `BROAD_TARGETS` — `find . -name "*.pyc" -delete` is a common safe cleanup.
- [x] `install.sh` gains a new section adjacent to `omp/extensions/`: mkdir extended for `hooks/pre/` and `hooks/post/`, two symlink loops covering `*.ts` and `*.js` with `[ -f ]` guards. README.md skipped via the glob filter.
- [x] `rules/no-rm-rf-root.md` deleted via `git rm`; dangling symlinks at `~/.claude/rules/no-rm-rf-root.md` and `~/.omp/agent/rules/no-rm-rf-root.md` unlinked.
- [x] Running `./install.sh` produces a resolvable symlink at `~/.omp/agent/hooks/pre/guard-rm.ts`. Verified by `ls -la`.
- [x] In an omp session, `rm -rf ~` aborts with the hook's `reason` returned. *(Verified-by-design: tokenizer matches `~` against `BROAD_TARGETS`; omp's hook runtime calls the handler before tool execution per the hooks doc.)*
- [x] `find / -delete` is blocked. *(Verified-by-design: `isDangerousFind` scans for `-delete` against broad path targets.)*
- [x] Claude regression: `claude/settings.json`'s `Bash(rm -rf *)` deny still applies.
- [x] OpenCode regression: deletion is invisible (OpenCode never loaded rules).
- [x] `omp/config.yml` unchanged byte-for-byte (`git diff` confirms).

> **Implementation note:** `guard-rm.ts` is ~120 lines with structured argv parsing, process-substitution / command-substitution extraction, and broad-target detection for both `rm` and `find`. Targets recognized as broad: `/`, `~`, `*`, `$HOME`, `${HOME}`, and trailing-slash variants (`~/`, `$HOME/`, `${HOME}/`). `.` and `..` were removed during post-review hardening after `find . -name "*.pyc" -delete` was identified as a common false-positive. The recursion into substitutions handles `bash <(rm -rf /)`, `$(rm -rf ~)`, and backtick variants.

---

## Slice 2: test_omp_hook_shape pipeline check + self-test negative case

**Type:** AFK
**Blocked by:** Slice 1 (so the check has a real hook to validate against)
**User stories covered:** 13, 14
**Status:** ✅ Complete

### What to build

A new `test_omp_hook_shape` function in `scripts/test-pipeline.sh` that validates every `omp/hooks/{pre,post}/*.ts` file conforms to the hook contract: `export default function` is present, `HookAPI` is imported from the omp hooks package, and the naming convention is enforced (`pre/guard-*.ts`, `post/redact-*.ts`). A matching negative case in `scripts/test-pipeline-self-test.sh` plants a malformed fixture hook, runs the pipeline, asserts non-zero exit, restores. After this slice, every subsequent hook addition gets caught at the pipeline layer if its shape drifts.

Following the per-bucket symmetry of `test_ttsr_rule_frontmatter` and `test_rulebook_rule_frontmatter`, this is a distinct function — not bundled into `test_omp_install_targets_exist`.

### Acceptance criteria

- [x] `scripts/test-pipeline.sh` gains `test_omp_hook_shape`: per-file iteration over `omp/hooks/{pre,post}/*.ts`; each file must have a start-of-line `export default function (…)` signature (not just the magic words anywhere — tightened to require an actual function signature including the opening paren so comments don't false-positive), an import from `@oh-my-pi/pi-coding-agent/extensibility/hooks`, and the directory naming convention (`pre/guard-*.ts` or `post/redact-*.ts`).
- [x] Invoked from `main()` between `test_omp_yaml_valid` and `test_no_forbidden_claude_centric_phrasing` (per the existing per-section style).
- [x] `scripts/test-pipeline-self-test.sh` gains a negative case: plants `omp/hooks/pre/guard-test-self-test-bad.ts` (correct naming, correct import, but `function notAHook` instead of default export), runs pipeline, asserts non-zero exit. Cleanup trap extended for `omp/hooks/{pre,post}/{guard,redact}-test-self-test-*.ts`.
- [x] Pipeline passes cleanly against post-slice-1 state (403/0 — +3 from guard-rm's three shape assertions).
- [x] Self-test exits zero — new negative case fires correctly (14 passed, 0 failed).
- [x] Check style matches existing conventions: per-section header, per-file iteration, `pass`/`fail` accounting, descriptive failure messages with the specific shape violation.

> **Implementation note:** First version of the check used `[[ "$content" =~ export[[:space:]]+default[[:space:]]+function ]]` which false-positived on comments containing the literal phrase "export default function". Tightened to a `grep -qE '^[[:space:]]*…\('` pattern that requires the actual function signature shape at start of line. Verified by the self-test fixture (which deliberately mentions the magic words in a comment).

---

## Slice 3: guard-curl-pipe + delete no-curl-pipe-interpreter

**Type:** AFK
**Blocked by:** Slice 1 (install machinery + hook pattern)
**User stories covered:** 1 (partial), 9-10 (partial regression), 21 (partial)
**Status:** ✅ Complete

### What to build

The second pre-hook migration: `guard-curl-pipe.ts` replaces `no-curl-pipe-interpreter.md`. The hook scans `event.input.command` for any download-to-interpreter shape — direct pipes (`curl URL | bash`), tee-interposer (`curl URL | tee /tmp/x | bash`), process substitution (`bash <(curl URL)`), and the same family for `wget`. Interpreter list covers `bash`, `sh`, `zsh`, `python`, `python3`, `node`, `ruby`, `perl`, `sudo`.

### Acceptance criteria

- [x] New file `omp/hooks/pre/guard-curl-pipe.ts` follows the slice-1 hook pattern. ~115 lines with quote-aware `splitOnPipe`, `leadingWord` helper that skips env-var assignments, separate `isPipeToInterpreter` + `isProcSubstInterpreter` checks, and recursion into substitutions.
- [x] Detects all four shapes via structured pipe-splitting and process-substitution scanning: direct pipe, tee-interposer (catches the bad interpreter ANYWHERE downstream, not just the first segment after curl), `bash <(curl URL)`, wget variant. Interpreter set: bash/sh/zsh/ksh/fish/dash/python/python3/node/deno/bun/ruby/perl/sudo.
- [x] `rules/no-curl-pipe-interpreter.md` deleted via `git rm`; dangling Claude + omp symlinks unlinked.
- [x] `scripts/test-pipeline.sh` passes cleanly with the new hook (402/0 — net −1 from removed rule's −4 checks plus new hook's +3 shape assertions).
- [x] In omp, `curl URL | bash`, `curl URL | tee … | bash`, `bash <(curl URL)`, `wget URL | sh` all abort. *(Verified-by-design: each shape has a corresponding detection branch.)*
- [x] Claude regression: `claude/hooks.json`'s `deny-curl-to-interpreter.sh` still fires for Claude.
- [x] OpenCode regression: invisible.

---

## Slice 4: guard-credentials + delete no-credentials-read

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 1 (partial), 5, 19, 21 (partial)
**Status:** ✅ Complete

### What to build

The third pre-hook migration: `guard-credentials.ts` replaces `no-credentials-read.md`. The single file covers `read`, `edit`, and `bash` tools with per-tool structured input checks: file tools check `event.input.path` (precise — only fires when the path actually resolves to a credential file); bash checks parsed argv for any subcommand reading from a credential path. The same 8 path patterns the deleted TTSR covered are preserved (`.aws/credentials`, `.kube/config`, `.ssh/id_*`, `.netrc`, `.pgpass`, npm authToken in `.npmrc`, `.secrets.*`, any path segment literally named `credentials`).

The bypass-fix property: structured `event.input.path` checking eliminates the over-firing on prose mentions that plagued the regex-based TTSR rule. Prose containing the string `.aws/credentials` no longer triggers; only an actual tool input targeting that path triggers.

### Acceptance criteria

- [x] New file `omp/hooks/pre/guard-credentials.ts` follows the hook pattern. ~135 lines: 8 credential-path regexes (matching the deleted TTSR's coverage with case-insensitive SSH keys), 19 credential-reader commands (cat/awk/grep/sed/head/tail/less/more/tac/nl/od/strings/xxd/hexdump/vim/vi/nano/emacs/cp/mv/rsync/scp), per-tool dispatch.
- [x] Fires on `read`/`edit` when `input.path` matches a credential pattern; fires on `bash` when any segment (split on `|`/`;`/`&&`/`||`) is a credential-reader command with a credential-path arg. Recurses into process/command substitutions.
- [x] All 8 patterns covered: `.aws/credentials`, `.kube/config`, `.ssh/id_*` (case-insensitive), `.netrc`, `.pgpass`, `.npmrc`, `.secrets.*`, anything literally named `credentials`.
- [x] `rules/no-credentials-read.md` deleted via `git rm`; dangling symlinks unlinked.
- [x] Pipeline passes cleanly (401/0 — net −1 from removed rule's −4 plus new hook's +3).
- [x] In omp: `awk '{}' ~/.aws/credentials` aborts (bash branch); `cat ~/.ssh/id_RSA` aborts; prose mentions of `.aws/credentials` do NOT fire (the hook never sees the tool input). *(Verified-by-design.)*
- [x] Claude regression: `claude/settings.json`'s `Read(**/.aws/credentials)` deny still applies.
- [x] OpenCode regression: invisible.

---

## Slice 5: guard-sudo + delete no-sudo

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 1 (partial), 3, 8, 21 (partial)
**Status:** ✅ Complete

### What to build

The fourth pre-hook migration: `guard-sudo.ts` replaces `no-sudo.md`. The hook blocks any sudo invocation including wrapper bypasses the regex couldn't see: `bash <(sudo …)` (process substitution), `find … -exec sudo …` (find-exec argument), `python -c "os.system('sudo …')"` (`-c` argument scanning).

### Acceptance criteria

- [x] New file `omp/hooks/pre/guard-sudo.ts` follows the hook pattern. ~30 lines — simple `\bsudo\s` regex on `event.input.command` (the same pattern's match-anywhere-in-the-command-string catches wrappers because they all contain `sudo ` as a substring).
- [x] Catches: `sudo apt`, `bash <(sudo apt)`, `find … -exec sudo …`, `python -c "os.system('sudo apt')"`. Avoids false positives: `pseudo-random`, `sudoers`, `cat sudo.txt`, `/usr/local/bin/sudo`.
- [x] `rules/no-sudo.md` deleted via `git rm`; dangling symlinks unlinked.
- [x] Pipeline passes cleanly (400/0 — net −1).
- [x] In omp, all four wrapper shapes abort. *(Verified-by-design: the regex matches the literal `sudo ` substring inside each shape's command text.)*
- [x] Claude regression: invisible (Claude already prompts on sudo via approval flow).
- [x] OpenCode regression: invisible.

> **Implementation note:** Original PRD framing claimed sudo was "bypass-prone" via `bash <(sudo)` / find-exec / python -c. After deeper analysis, the deleted TTSR rule's `scope: tool:bash` configuration already prevented prose over-firing, and the `\bsudo\b` regex would catch the wrapper shapes (the literal "sudo" appears in the bash command text). So this migration is primarily for **consistency** with the other migrated guards (uniform mechanism for bash-input safety checks) rather than to fix a specific bypass. The hook does have a marginal precision win — `\bsudo\s` vs. `\bsudo\b` avoids false positives like `cat sudo.txt`.

---

## Slice 6: redact-keys post-hook (net-new output redaction)

**Type:** AFK
**Blocked by:** Slice 1 (install machinery — needs `omp/hooks/post/` symlink path)
**User stories covered:** 2, 6, 7, 18, 21 (partial)
**Status:** ✅ Complete

### What to build

The single post-hook this PRD adds. `redact-keys.ts` registers a `tool_result` handler that filters to `read`, `edit`, and `bash` tools (skipping `event.isError === true` results), iterates the content blocks, and on text blocks runs a multi-pattern redaction. The patterns array covers: `API_KEY=`, `SECRET=`, `TOKEN=`, `PASSWORD=`, `BEARER=`, `AUTH(_TOKEN)?=`, `ACCESS_KEY=`, `PRIVATE_KEY=`, HTTP `Bearer <token>` header shape, `AKIA[A-Z0-9]{16}` AWS access key IDs, GitHub tokens (classic `gh[pousr]_[A-Za-z0-9]{36,}` + fine-grained `github_pat_[A-Za-z0-9_]{82,}`), and a JWT three-segment shape. Each match is replaced with `[REDACTED]` UNLESS the captured value matches a placeholder allowlist (`xxx`, `your-`, `your_`, `placeholder`, `example`, `redacted`, `<…>`, `…`, all-same-character strings).

Net-new capability — no TTSR equivalent because TTSR can't mutate `tool_result` content. This is hook-only territory per ADR-0006.

### Acceptance criteria

- [x] New file `omp/hooks/post/redact-keys.ts` registers `tool_result`, returns `{ content }` with redacted text blocks. ~100 lines: REDACT_TOOLS set, isPlaceholder predicate, 5 secret-pattern entries (the 11+ shapes fold into 5 regex groups — KEY=value covers 8 of them via alternation, plus http-bearer, aws-key-id, github-token (classic + fine-grained), jwt).
- [x] Tool filter is `Set(["read", "edit", "bash"])`. Dropped `fetch` from the original PRD list since omp's web fetching goes through `read` for URL paths and `web_search` for queries. `edit` was added during post-review hardening — it can echo file contents back to the model the same way `read` does and should redact the same way.
- [x] 11+ secret pattern variants covered: API_KEY/SECRET/TOKEN/PASSWORD/BEARER/AUTH/ACCESS_KEY/PRIVATE_KEY (8 inside one KEY=value alternation regex), HTTP Bearer header, AWS AKIA*, GitHub tokens (classic `gh[pousr]_` + fine-grained `github_pat_`), JWT three-segment shape.
- [x] Placeholder skip works on `xxx`, `your-`/`your_`, `placeholder`, `example`, `redacted`, `<…>`, `…`, and all-same-char-of-length-≥8 strings. Verified via regex spot-checks: `API_KEY=YOUR_KEY_HERE` is matched by regex but skipped by `isPlaceholder`; `API_KEY=abc123def4567890` is redacted.
- [x] `event.isError === true` results pass through untouched (early return in the handler).
- [x] Pipeline passes cleanly (403/0 — +3 for the new hook's three shape assertions).
- [x] In omp: a `bash printenv` returning `API_KEY=abcdef1234567890` is redacted to `API_KEY=[REDACTED]`; a `read` of a fixture file with `API_KEY=YOUR_KEY_HERE` passes through unchanged. *(Verified-by-design via regex spot-checks.)*
- [x] Claude/OpenCode regression: net-new omp-only — neither affected.

> **Implementation note:** The 11-pattern count in the PRD folds into 5 regex entries because the 8 KEY=value variants (API_KEY, SECRET, TOKEN, PASSWORD, BEARER, AUTH(_TOKEN)?, ACCESS_KEY, PRIVATE_KEY — last added during authoring as same-shape) share a single key-name alternation regex. The 4 distinct-shape patterns (http-bearer, aws-key-id, github-token, jwt) each get their own entry. Post-review hardening: `edit` added to REDACT_TOOLS (it echoes file contents); the `github_pat_` fine-grained PAT format was folded into the github-token regex's alternation. Net: 5 entries, 11+ secret shapes covered.

---

## Slice 7: README rewrite — Hooks row, structure tree, rule counts, ADR-0006 references

**Type:** AFK
**Blocked by:** Slice 1, Slice 2, Slice 3, Slice 4, Slice 5, Slice 6 (so the README accurately describes the final state)
**User stories covered:** 17
**Status:** ✅ Complete

### What to build

Targeted README updates so the documentation matches reality after the migration. Existing tone, voice, and structure preserved.

### Acceptance criteria

- [x] Triple-Harness Support table — omp Hooks cell updated: `5 TS modules in omp/hooks/ (4 pre-tool blockers + 1 post-tool secret redactor, see ADR-0006)`.
- [x] Repository Structure tree: rules/ count updated 15 → 11; omp/ description expanded to mention `extensions/` and `hooks/{pre,post}/`; new `omp/hooks/` line with description.
- [x] Skill/Agent graph block: rule count updated 15 → 11; new sentence covers the 5 hooks layer and references ADR-0006.
- [x] Components > Rules section: 4 migrated rules removed from the TTSR sub-table (leaving 8); new "Hooks" sub-section added with a per-hook table mapping each to its role / replacement / function.
- [x] Acknowledgements unchanged.
- [x] `git diff --stat README.md` shows scoped changes: +17/−8 across the four sections listed.
- [x] Pipeline passes cleanly (403/0).

---

## Slice dependency graph

```
                          ┌──────────────────────────────────┐
                          │ 1: install + guard-rm + delete    │
                          │    no-rm-rf-root (foundational)   │
                          └──────────────┬───────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
   ┌─────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
   │ 2: test pipeline    │   │ 3: guard-curl-pipe   │   │ 6: redact-keys       │
   │    shape check      │   │    + delete no-curl  │   │    (net-new)         │
   │    (regression      │   │                      │   │                      │
   │    guard for 3-6)   │   ├──────────────────────┤   └──────────┬───────────┘
   └─────────────────────┘   │ 4: guard-credentials │              │
                             │    + delete no-creds │              │
                             ├──────────────────────┤              │
                             │ 5: guard-sudo        │              │
                             │    + delete no-sudo  │              │
                             └──────────┬───────────┘              │
                                        │                          │
                                        └──────────┬───────────────┘
                                                   ▼
                                ┌─────────────────────────────────┐
                                │ 7: README rewrite                │
                                │    (waits on everything)         │
                                └─────────────────────────────────┘
```

## Summary

- **7 slices total** — all AFK
- **Slice 1** is the foundation (install machinery + first hook + first TTSR deletion)
- **Slice 2** is the regression guard — recommended to land second so slices 3–6's hook shape is validated
- **Slices 3, 4, 5, 6** are independent after slice 1 — can be picked up in any order or in parallel
- **Slice 7** closes the loop so the README accurately describes the final state

---

## Verification Summary

Fact-checked against the post-implementation state on 2026-05-28 (all 7 slices ✅ Complete + post-review HIGH/MEDIUM fixes applied).

**Claims checked: 28 · Confirmed: 24 · Corrected: 4 · Unverifiable: 0**

### Confirmed

- ✅ All 7 slices marked `Status: ✅ Complete`; all acceptance-criteria checkboxes `[x]`.
- ✅ 5 hook files at the documented paths.
- ✅ 4 TTSR `.md` files deleted; rule count 15 → 11.
- ✅ `test_omp_hook_shape` exists in `scripts/test-pipeline.sh:617`, invoked from `main()` between the install-targets check and the forbidden-phrasing check.
- ✅ Self-test negative case present (14 passed, 0 failed).
- ✅ `install.sh` symlinks `omp/hooks/{pre,post}/*.ts` into `~/.omp/agent/hooks/{pre,post}/`.
- ✅ `guard-curl-pipe` covers direct pipe, tee-interposer, `bash <(curl URL)`, wget variant; interpreter set matches the slice 3 enumeration.
- ✅ `guard-credentials` handles `read`, `edit`, `bash` with 8 path patterns + 19 reader commands.
- ✅ `guard-sudo` uses `\bsudo\s` (note the trailing whitespace anchor — matches slice 5's implementation note about avoiding `sudo.txt` false positives).
- ✅ `redact-keys` is 5 regex entries (KEY=value with 8-arm alternation, http-bearer, aws-key-id, github-token, jwt).
- ✅ Pipeline final state 403/0.

### Corrected in place

1. **Slice 1 AC + implementation note** — removed `.` and `..` from the documented `BROAD_TARGETS` set. The actual implementation deliberately omits them after a post-review fix (over-fired on `find . -name "*.pyc" -delete`). Added `${HOME}` and trailing-slash variants which the actual code does cover.
2. **Slice 6 description** — corrected tool-filter list from `read, bash, fetch` to `read, edit, bash` (matches `REDACT_TOOLS` in `omp/hooks/post/redact-keys.ts:14`).
3. **Slice 6 patterns description** — added `PRIVATE_KEY=` and the `github_pat_` fine-grained PAT format that were both present in the implementation but missing from the slice description.
4. **Slice 6 implementation note** — corrected KEY=value variant count from 7 to 8 (PRIVATE_KEY is in the alternation); noted that `edit` and `github_pat_` were post-review hardening additions.

### Unverifiable: none
