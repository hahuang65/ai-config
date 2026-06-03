# Drop OpenCode support

This repo began as multi-harness (Claude Code, OpenCode, oh-my-pi). OpenCode was rarely used and its gaps made the cross-harness story leaky: it loads neither agents nor rules, so the `/build` review chain — which runs the `code-reviewer`, `database-reviewer`, `refactor-cleaner`, and `doc-updater` **agents** — had no defined behavior there, and the permission story required a whole Claude→OpenCode sync script. We dropped OpenCode entirely, leaving two harnesses: **Claude Code** and **oh-my-pi**.

## What changed

- Removed the OpenCode install blocks from `install.sh`, the `opencode/` config dir (`opencode.jsonc`, `tui.json`), `config/opencode-only.json`, and `scripts/sync-permissions.py` (whose sole job was the Claude→OpenCode permission bridge).
- Removed the permission-sync step from `.githooks/pre-commit` and `~/.config/opencode` from `claude/settings.json`'s `additionalDirectories`.
- Rewrote `README.md`, `CONTEXT.md`, and `AGENTS.md` to a two-harness model.

## Consequences

- **Agents and rules now reach every harness this repo configures.** OpenCode was the one harness that ran neither; with it gone, the skill-vs-agent choice is about the *nature* of the work, not harness coverage. This updates the premise behind ADR-0001 (full-mirror) and ADR-0004 / ADR-0005 (which weighed OpenCode in their reasoning) — those remain accurate as historical records of the three-harness era.
- **No permission sync remains.** `claude/settings.json` stands alone as Claude Code's source of truth; `oh-my-pi`'s `omp/config.yml` stays hand-authored and decoupled.
- `docs/features/` (the harness-neutral artifact name from ADR-0007) stays — the rename was right regardless, and re-churning paths back to a Claude-specific name would be pointless.
- Re-adding a harness later means copying the `oh-my-pi` install block in `install.sh` and writing its config; nothing about the dual-harness layout precludes it.
