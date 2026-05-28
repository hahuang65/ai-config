# TTSR is the runtime enforcement layer for omp; rulebook is advisory

Claude Code enforces dangerous-pattern bash safety via the `claude/settings.json` permission denylist (`Bash(git push --force *)`, `Bash(rm -rf *)`, `Bash(curl * | bash*)`) plus a `PreToolUse` hook (`scripts/hooks/deny-curl-to-interpreter.sh`). omp has no equivalent per-pattern allowlist — its `tools.approvalMode` is tier-based (`read`/`write`/`exec`) with hardcoded critical-pattern detection on `bash`. **We chose TTSR (time-traveling stream rules) as the runtime enforcement layer for omp**, with the rule set split into two buckets:

- **Rulebook (3 files: `coding-style.md`, `testing.md`, `performance.md`)** — `description:` only. Listed in omp's system prompt; loaded on demand via `rule://<name>`. Advisory, not enforced.
- **TTSR (8 files: `security.md`, `git-workflow.md`, `no-curl-pipe-interpreter.md`, `no-rm-rf-root.md`, `no-cloud-destroy.md`, `no-shell-write.md`, `no-credentials-read.md`, `no-deploy.md`)** — each has `description:` + `condition:` regex array + scoped tool surfaces. omp aborts the model's stream mid-token on any regex match and injects the rule body as a system reminder before retrying. The 6 `no-*.md` files were added at user request during grilling to close additional gaps Claude's per-pattern denylist covers (broad rm, cloud-destroy, shell-redirect-write, credential reads, deploy commands).

We also **deleted `rules/development-workflow.md`** as part of this decision. The cross-reference audit found it is referenced by zero agents and zero skills — it described a workflow the `/build` skill already orchestrates as code, making it pure redundancy with `/build`. The README's pipeline overview is the canonical version.

Reasons for the split:

1. **TTSR is the only mechanism omp has that approximates Claude's per-pattern bash denylist.** Without TTSR, omp users running our config would lose the safety net that has been preventing accidental force-pushes, `curl … | bash`, and `rm -rf /` from the model. Tier-based approval alone (`tools.approvalMode: write`) only prompts; it doesn't refuse, and prompts in subagent contexts auto-approve under headless `yolo`.
2. **Security and git policy are exactly the use case TTSR was built for.** The fire-on-contact regex model is more effective than asking the model to remember to `read rule://security` before writing auth code. Both halves of this argument — that TTSR is more reliable AND that rulebook descriptions are model-dependent — drove security.md and git-workflow.md out of the rulebook and into TTSR.
3. **Advisory rules don't need byte-level enforcement.** `coding-style.md`, `testing.md`, and `performance.md` are broad style guidance — regex-detecting them would over- or under-fire. They belong in the rulebook where they can be loaded on demand and surfaced to the model only when relevant.
4. **The `code-reviewer` agent and friends still read rulebook rules as files.** Even though omp doesn't auto-inject rulebook rules into the system prompt, agents like `code-reviewer`, `tdd-guide`, `architect`, and `refactorer` reference them by relative path (`rules/coding-style.md`) and pull them in directly. The rulebook/TTSR split affects only what the *main* session sees by default; downstream agents are unchanged.

Consequences:

- Claude Code is unaffected: it auto-loads all 11 rule files (3 rulebook + 8 TTSR) as global user instructions. The TTSR frontmatter (`condition:`, `scope:`) is inert metadata from Claude's perspective; the rule bodies still apply.
- OpenCode is unaffected: it doesn't load rules today, so the count change from 6→11 is invisible.
- `skills/implement/SKILL.md` says "the project rules already loaded in context" — Claude-Code-centric phrasing that becomes inaccurate under omp's rulebook lazy-load. Implementation phase will tweak it to read "load via `rule://<name>` when entering the rule's domain."
- Future TTSR rules can be added without changing the install model. Just drop another file with `condition:` into `rules/` and it joins the enforcement set.
