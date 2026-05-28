# Hooks replace TTSR for input-bound patterns with known regex bypasses

[ADR-0004](0004-omp-permissions-and-hooks-decoupled.md) declared that omp's hook system would not be used — TTSR rules were the per-pattern enforcement layer, and porting Claude's shell hook to omp's TS/JS module format was unnecessary because TTSR `no-curl-pipe-interpreter.md` "already enforces the same surface." That reasoning was correct at the time, but living with the TTSR-only safety stack revealed real bypasses that markdown-level regex can't fix: `bash <(curl URL)` slips past `no-curl-pipe-interpreter`, `find / -delete` slips past `no-rm-rf-root`, `bash <(sudo …)` slips past any `\bsudo\b` regex on stream text, and `no-credentials-read`'s broad regex over-matches on prose mentions of credential paths. **We now adopt omp hooks selectively, alongside (not replacing) the TTSR rule layer**, with explicit criteria for which mechanism each pattern belongs to.

This supersedes the third pillar of ADR-0004 (the "no hook port" pillar). The other two pillars — hand-authored `omp/config.yml` and no extension of `sync-permissions.py` to omp — remain in force.

## What changed

- 4 existing TTSR `.md` files were deleted: `no-curl-pipe-interpreter.md`, `no-rm-rf-root.md`, `no-credentials-read.md`, `no-sudo.md`.
- 5 hook files were added: `omp/hooks/pre/guard-rm.ts`, `pre/guard-curl-pipe.ts`, `pre/guard-credentials.ts`, `pre/guard-sudo.ts`, `post/redact-keys.ts`.
- The first 4 hooks replace the deleted TTSR rules. The 5th (`redact-keys`) is a net-new capability — output redaction, which TTSR fundamentally cannot do (TTSR can only block; it can't mutate `tool_result` content).
- `install.sh` gained a parallel install path for `omp/hooks/{pre,post}/*.ts`, alongside the existing `omp/extensions/` path. Both follow omp's discovery convention: `~/.omp/agent/hooks/{pre,post}/*.ts` is the user-level discovery root per omp's hooks doc.
- 8 TTSR `.md` files remain unchanged: `security.md`, `git-workflow.md`, `no-cloud-destroy.md`, `no-shell-write.md`, `no-deploy.md`, `no-db-mutation.md`, `no-dd-disk.md`, `no-broad-chmod.md`. These either fire on content the model is writing (security) or are simple enough that regex works without known bypasses.

## Criteria for hook vs. TTSR (use this when authoring future rules)

A new safety rule belongs as a **hook** if any of these are true:

1. The pattern is **bound to a tool's structured input** (e.g., `event.input.command` for bash, `event.input.path` for read/edit) and structured parsing catches what regex can't — process substitution (`bash <(…)`), find-exec (`find … -exec …`), interpreter wrappers (`python -c "os.system(…)"`).
2. The pattern requires **mutating tool output** rather than blocking — secret redaction, content filtering, response transformation. TTSR fundamentally cannot do this; hooks can via `tool_result` returns.
3. The pattern is **multi-tool** and benefits from per-tool structured logic — e.g., a credential check that examines `event.input.path` differently from `event.input.command`.

A new safety rule belongs as **TTSR** if any of these are true:

1. The pattern fires on **content the model is writing into files** (Write/Edit payloads with hardcoded secrets, string-concat SQL, eval-on-user-input) — TTSR sees the stream as it's being typed; hooks see only the final tool call.
2. The benefit of the **abort + retry + system-reminder** dynamic outweighs the bypass risk — the model gets the rule body injected and re-plans, which is genuinely useful course-correction UX.
3. The pattern is **simple enough that regex has no realistic bypass** and the markdown-authoring UX is preferable — e.g., `dd of=/dev/…`, `chmod -R` of broad paths.

## Reasons we picked this hybrid over the alternatives

- **Hooks for all 12 bash-bound rules ("hook-first")** was rejected because the marginal cases (no-cloud-destroy, no-deploy, no-shell-write, no-db-mutation, no-dd-disk, no-broad-chmod) have working regex with no realistic bypass — migrating them buys nothing and trades markdown UX for TypeScript.
- **TTSR for all (the prior policy)** was rejected because the 4 strong-migrate cases have real bypasses we can't fix without structured parsing.
- **Defense-in-depth (write the hooks AND keep the TTSR rules)** was rejected to avoid two enforcement layers covering the same surface, with two places to maintain when policy changes and two places to debug when blocking fires unexpectedly. The deleted TTSR rules had genuinely the same scope as the hooks replacing them.

## Consequences

- The 4 deleted rule bodies were the model-facing "what you tried / why blocked / alternative" guidance. Hooks deliver equivalent guidance via the `reason` string returned to the model as the tool call's error. The `reason` is shorter than the full rule body but more targeted (it can include the actual blocked command snippet).
- Claude Code users lose the 4 rule bodies from their global instructions. The dangerous patterns those rules covered are still blocked on Claude by `claude/settings.json`'s per-pattern Bash denylist (force-push, `curl … | bash*`, `rm *`, etc.) plus the curl-to-interpreter shell hook — none of which were touched. So no Claude safety regression.
- OpenCode users were never affected by the rules (OpenCode doesn't load them); also no change.
- The omp-side safety stack is now: tier-based approval (`approvalMode: write` with bash on `allow`) + omp's built-in critical-pattern detector + 8 TTSR rules + 5 hooks. Layered, with clear surfaces.
- Future rule authors get a decision tree (the criteria above) instead of "everything is TTSR by default."
