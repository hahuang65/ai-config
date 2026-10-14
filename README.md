# Shared Claude and Pi configuration

This checkout is the currently installed, unified configuration source for ordinary Claude Code and Pi.
Keep its source and built release tools available while installed links point here.
The evaluation checkout is retained as the former source, not the live bootstrap.

## Installed package

`manifest.json` declares the installation-owned resources.
Shared resources live directly in `skills/`, `agents/`, `commands/`, `rules/`, and `guard/`, with `baseline.md` at the root.
Harness-specific source lives in `harnesses/claude/` and `harnesses/pi/`; the standalone Rust tools live in `tools/`.
The restricted reviewer also uses root `reviewer.md` and `harnesses/pi/review-scope.ts` as checked support files, not ordinary installed resources.

The installed package provides:

- Shared baseline instructions and guarded tool-call adapters for both harnesses.
- The familiar two-line Claude and Pi status displays and Catppuccin themes, without agentmemory.
- Claude's feature-disable settings and selected LSP plugins; a local `ty server`/`ruby-lsp` plugin provides Python and Ruby LSP without Astral's or Ruby's skill bundles or auto-installing launchers. Server tools remain independently provisioned through mise.
- Explicit `/deliver` and `/rebase` commands in both harnesses; `/resolve-conflicts` is the shared skill for a rebase already in progress.
- Curated shared skills under `skills/`; the optional `review-change` skill selects the current harness's independently restricted reviewer.
- The evaluation's specialist roles: API designer, change reviewer, database reviewer, fact checker, and frontend architect.
- Bundled `wt`/`worktree` and `wl`/`worklog` commands, plus the Rust browser-review and change-review commands needed by the retained skills.

TypeSafe and Herdr remain independently configured.
Worklog data stays in its existing private store; no old Work log history is queried or imported.
Ordinary user and project resources remain discoverable, while restricted reviewers use isolated snapshots.
The installer changes only recorded owned links and narrow guardrail settings; it preserves unrelated resources, login, models, sessions, and project trust.
It never provisions tools, touches services, or deletes private state.

Before a repository edit, use a verified task worktree; `skills/worktree/SKILL.md` describes safe creation, entry, and cleanup with `wt` or `worktree`.
A direct-checkout exception requires the user's up-front choice for one self-contained change and commit authorization.
Creating a worktree does not move a running conversation; resume or start one in the new checkout before editing.
Claude uses its native `/resume` when a previous task conversation is needed.
This package does not install automatic Claude or Pi task-conversation adapters, a Pi language-server client, or the former agentmemory and background publication services.
The commands do not push or clean worktrees automatically.
Local delivery requires project checks and a verified fast-forward; provider review is a separate, explicitly requested workflow.
GitHub delivery retains the branch and worktree for a separately authorized PR workflow.
Dated historical decision records may describe retired experiments; they are not part of this package.

## Build and verify

Use the versions pinned in `mise.toml` directly; do not install tools as a testing side effect.

```sh
make build
make lint
make test
```

`make build` creates the Pi guard and status-footer bundles and Rust release binaries offline; it **does not install**.
Tests use disposable homes and fake providers, not the live harness state.

After a disposable-home rehearsal and **separate approval for a live home**, the explicit installer is:

```sh
tools/evaluation/target/release/ai-config --root "$(pwd -P)" install
```

The installer switches only declared links and settings and records ownership under `~/.local/state/ai-config/installation.json`.
A Git revert cannot retarget already installed links; recovery needs another explicit operation.
Do not run the removed legacy installer, delete `pi-evaluation`, stage, commit, push, or change the parent submodule pointer by implication.
