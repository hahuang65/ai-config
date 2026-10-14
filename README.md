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

Both status displays place the directory, Git branch, and available session name on the first row, with token/cache usage, cost, context, and model/thinking on the second.
Claude uses the current [status-line input](https://code.claude.com/docs/en/statusline): `session_name`, `effort.level`, and `thinking.enabled`, retaining the older `thinking_level` fallback.
Disabled thinking displays `thinking off`; enabled thinking without an effort value displays `thinking on`; missing thinking data stays omitted.
The displays use each harness's supplied usage data, not identical accounting: Claude falls back to the latest request's cache counts when cumulative counts are absent, while Pi sums its conversation branch.
Claude fits the display to `COLUMNS` (up to 4096) with the existing four-column host margin; it does not read transcripts or restore agentmemory.

TypeSafe and Herdr remain independently configured.
Worklog data stays in its existing private store; no old Work log history is queried or imported.
Ordinary user and project resources remain discoverable, while restricted reviewers use isolated snapshots.
Failed change reviews retain [bounded, credential-safe diagnostics](docs/review-change-cli.md#reviewer-failures), not raw provider output or a publishable report.
The installer changes only recorded owned links and narrow guardrail settings; it preserves unrelated resources, login, models, sessions, and project trust.
It never provisions tools, touches services, or deletes private state.

Before a repository edit, use a verified task worktree; `skills/worktree/SKILL.md` describes safe creation, entry, and cleanup with `wt` or `worktree`.
A direct-checkout exception requires the user's up-front choice for one self-contained change and commit authorization.
[Native task adapters](docs/worktree-transitions.md) carry the current conversation into a new task and resume a saved task conversation without converting between harnesses.
Pi uses `/wt` and its native session replacement; Claude uses `EnterWorktree` and native `/resume` with conversation and directory checks.
The [shared continuation contract](docs/worktree-transitions.md#shared-continuation-contract) resumes already-requested work once after verified native completion, without new authorization.
Pi starts a destination turn; Claude attaches the same notice to its existing native tool loop.
Claude's interactive `/resume` cannot start a turn through hooks and explicitly requires a subsequent `continue` message; it is not advertised as automatic.
Both provide `/wt leave` to carry the current conversation back to the primary directory without cleanup; Claude's `/wt` command guides native tool use.
Neither adapter claims exclusive use of a worktree, checks process ownership, or acquires session locks.
Creating a worktree through the standalone CLI still does not move a running conversation.
This package does not install a Pi language-server client or the former agentmemory and background publication services.
The commands never push automatically or clean merely because work ends.
Local delivery requires project checks and a verified fast-forward; provider review is a separate, explicitly requested workflow.
An explicit local delivery request also includes a native session return to the primary directory and safe worktree cleanup.
Cleanup also deletes the local task branch only when integrated into the recorded local target; incomplete transitions retain the worktree, and incomplete branch deletion is reported separately.
GitHub delivery retains the branch and worktree for a separately authorized PR workflow.
Dated historical decision records may describe retired experiments; they are not part of this package.

## Build and verify

Use the versions pinned in `mise.toml` directly; do not install tools as a testing side effect.

```sh
make build
make lint
make test
```

`make build` creates the Pi guard, status-footer, and worktree bundles and Rust release binaries offline; it **does not install**.
Tests use disposable homes and fake providers, not the live harness state.

## Install

After a disposable-home rehearsal and **separate approval for a live home**, run:

```sh
./install.sh
```

`install.sh` runs `make build` in its own checkout, then delegates to `tools/evaluation/target/release/ai-config --root <canonical-checkout> install`.
It works when invoked by path from another directory and stops before installation if the build fails.
It requires Bash, make, the mise-managed Bun and Rust build tools, and cached dependencies for the offline build; it does not provision them.
Run `./install.sh --help` for help without building or installing; other arguments, including the retired `--force`, are rejected before effects.
The destination is the absolute `HOME` directory inherited by the Rust installer, not the caller's working directory.
Use a disposable `HOME` for rehearsals and retain access to the already provisioned build tools and dependency caches.
`make build`, `make lint`, and `make test` never install into the live home; installation remains a separate explicit action.

The Rust installer remains responsible for ownership, conflict checks, settings preservation, and rollback.
The manifest and installed resource set are unchanged by this entry point.
The installer switches only declared links and settings and records ownership under `~/.local/state/ai-config/installation.json`.
A Git revert cannot retarget already installed links; recovery needs another explicit operation.
Do not run the removed legacy installer, delete `pi-evaluation`, stage, commit, push, or change the parent submodule pointer by implication.
