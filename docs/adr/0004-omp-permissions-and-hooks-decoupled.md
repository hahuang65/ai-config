# omp safety: hand-authored config + TTSR. No permission sync, no hook port.

Claude and OpenCode share a sympathetic per-pattern permission format, so `scripts/sync-permissions.py` reliably bridges them — `Bash(rm *)` becomes `"rm *": "deny"`. omp's permission model is structurally different: `tools.approvalMode` is a tier (read/write/exec) and `tools.approval.<tool>` is a binary allow/deny/prompt per tool, with **no per-pattern allowlist**. The ~115 per-pattern entries in `claude/settings.json` (allow + deny + ask, ~90 of them on `Bash`) have no place in omp's schema. We made three connected decisions for omp's safety story:

1. **Hand-author `omp/config.yml`.** Symlinked to `~/.omp/agent/config.yml` by `install.sh`. ~15 lines: `tools.approvalMode: write`, `tools.approval.bash: prompt` (also `browser/ssh/eval: prompt`), nothing else for v1. `sync-permissions.py` is not extended to write to omp; it stays a Claude↔OpenCode bridge.
2. **TTSR (8 rules) is omp's per-pattern enforcement layer** (see ADR-0003 for the full split). The rules cover everything Claude's denylist blocks that isn't covered by omp's built-in critical-pattern detector — force-push, hook-skip, curl-pipe-interpreter, broad rm, cloud destroy, shell-redirect writes, credential file reads, deploy commands. Augmented incrementally as gaps are noticed.
3. **The Claude hook (`scripts/hooks/deny-curl-to-interpreter.sh`) is NOT ported to omp.** omp's hook system wants TS/JS modules, not shell scripts, and the TTSR rule `no-curl-pipe-interpreter.md` already enforces the same surface. The shell hook stays as Claude's safety net; omp's equivalent is the TTSR rule.

Reasons this triplet hangs together:

- **Sync-script honesty.** A sync that silently dropped the bulk of Claude's per-pattern entries (because omp can't express patterns) would be misleading. Better to be explicit: Claude ↔ OpenCode is bridged; omp is decoupled by design.
- **Single safety story for omp.** "TTSR + omp's critical-pattern detector + tier-based approval" is one coherent model. Layering a synced permission denylist on top would be redundant infrastructure that does nothing.
- **`approvalMode: write` over `yolo`.** Auto-approves file reads/edits; prompts for exec tools (bash, browser, ssh, eval). This is the closest analog to Claude's "trust the agent on edits, ask before running" posture. `yolo` would let omp autorun bash, which expands the agent's autonomous reach beyond what Claude does today.
- **`tools.approval.bash: prompt` accepts more friction than Claude has.** In Claude, ~60 per-pattern allow entries (`rspec *`, `mise x -- rspec *`, etc.) auto-approve routine test/lint/build commands. In omp, every bash gets prompted — no per-pattern allowlist exists. Users see more prompts on omp than Claude for routine work. Accepted trade-off: safety > friction for the integration's v1.

Consequences worth knowing:

- New Claude permission additions don't auto-flow to omp. The author has to think "is there a sympathetic change for omp?" — usually the answer is "no, it's a per-pattern entry that has no omp equivalent." When the answer is "yes," it's either a `tools.approval.<tool>` flip in `omp/config.yml` or a new TTSR rule.
- The Claude hook will diverge from the omp TTSR rule over time. They cover the same surface today (curl-pipe-interpreter); future Claude hooks (if any are added) won't auto-replicate to omp. Same per-author discipline as the permission decoupling.
- If omp's permission model grows per-pattern support in a future release, this decision should be revisited — the sync extension would suddenly become tractable.
