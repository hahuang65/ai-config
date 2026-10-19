# Shared Claude and Pi configuration

This checkout is the currently installed, unified configuration source for ordinary Claude Code and Pi.
Keep its source and built release tools available while installed links point here.
The evaluation checkout is retained as the former source, not the live bootstrap.

## Installed package

`manifest.json` declares the installation-owned resources.
Shared resources live directly in `skills/`, `agents/`, `commands/`, `rules/`, and `guard/`, with `baseline.md` at the root.
Harness-specific source lives in `harnesses/claude/` and `harnesses/pi/`; the standalone Rust tools live in `tools/`.
The restricted reviewer also uses root `reviewer.md` and `harnesses/pi/review-scope.ts` as checked support files, not ordinary installed resources.
See the [tool inventory](docs/tool-inventory.md) for executable entry points, aliases, installer responsibilities, installed-state limits, and the selected pruning work.
Its [harness inventory](docs/harness-tool-inventory.md) distinguishes model tools from skills, hooks, language servers, and independently configured integrations.

The installed package provides:

- Shared baseline instructions and guarded tool-call adapters for both harnesses, using tree-sitter-bash for command syntax and documented [dangerous-command boundaries and limits](docs/command-guards.md).
- Shared [STE-inspired writing guidance](rules/writing.md) for replies, documents, comments, and commit messages.
  These practical defaults preserve technical meaning without a plugin, automatic enforcement, or a claim of ASD-STE100 compliance.
- The familiar two-line Claude and Pi status displays and Catppuccin themes, without agentmemory.
- Claude's feature-disable settings and a [shared language-server catalogue](docs/language-servers.md) for Python, Ruby, Lua, Go, Shell, Terraform, TypeScript/JavaScript, and Rust.
  Claude consumes a generated language-server-only plugin; Pi provides an on-demand `lsp` tool for navigation and diagnostics.
  Server tools are declared in `mise.toml` and provisioned explicitly, never by the harness adapters.
- Explicit `/deliver` and `/rebase` commands in both harnesses; `/resolve-conflicts` is the shared skill for a rebase already in progress.
- Curated shared skills under `skills/`; the optional `review-change` skill selects the current harness's independently restricted reviewer.
- The evaluation's specialist roles: API designer, change reviewer, database reviewer, fact checker, and frontend architect.
- Public `wt`/`worktree`, `wl`/`worklog`, and `review-change` symlinks, plus source-local `review-artifact` and `consult` helpers resolved by their consumers without PATH aliases.
- `review-change [SUBJECT]` for a PR URL, branch/worktree, GitHub branch URL, Git range, or the current branch plus outstanding changes; human reviews open directly in `review-artifact` without a manual intent field.
- Local change-review annotations and per-finding Accept/Reject controls: Accept authorizes that finding's repair only; commits and publication remain separate.
- PR reports use checkboxes and prefilled editable inline comments, never repair decisions; one Publish button below the document confirms the visible text, destinations, account and PR. The sidebar stays for agent feedback, and uncertain outcomes reconcile the same persisted attempt.
- Event-driven foreground artifact-review waits without an inactivity cutoff, plus revision-only refreshes that preserve current HTML/image hashing and approval safety.

Both status displays place the directory, Git branch, and available session name on the first row, with token/cache usage, cost, and context on the second.
Claude right-aligns model/thinking on the first row; Pi keeps it on the second.
Claude emits exactly two occupied rows without a trailing newline; its built-in permission-mode, effort, and update badges are separate host-owned footer rows, not positioned by this script.
Claude uses the current [status-line input](https://code.claude.com/docs/en/statusline): `session_name`, `effort.level`, and `thinking.enabled`, retaining the older `thinking_level` fallback.
Disabled thinking displays `thinking off`; enabled thinking without an effort value displays `thinking on`; missing thinking data stays omitted.
The displays use each harness's supplied usage data, not identical accounting: Claude falls back to the latest request's cache counts when cumulative counts are absent, while Pi sums its conversation branch.
Claude fits the display to `COLUMNS` (up to 4096) with the existing four-column host margin; it does not read transcripts or restore agentmemory.

TypeSafe and Herdr remain independently configured.
Worklog data stays in its existing private store; no old Work log history is queried or imported.
Ordinary user and project resources remain discoverable, while restricted reviewers use isolated snapshots.
Failed change reviews retain [bounded, credential-safe diagnostics](docs/review-change-cli.md#reviewer-failures), not raw provider output or a publishable report.
The installer changes only recorded owned links and narrow guardrail settings; it preserves unrelated resources, login, models, sessions, and project trust.
Explicit installation provisions the active mise tool configuration before building; it never touches services or deletes private state.

The [ordinary-work continuation policy](baseline.md#keep-work-moving) keeps authorized tasks moving after progress updates, worklog checkpoints, and completed workflow steps.
Completion, explicit user pauses, required decisions/approvals/manual actions, or forced interruptions are stopping points; a checkpoint does not renew or widen authorization.
This is shared instruction guidance, not a background restart mechanism or a guarantee of model compliance.

Before a repository edit, use a verified task worktree; `skills/worktree/SKILL.md` describes safe creation, entry, and cleanup with `wt` or `worktree`.
A direct-checkout exception requires the user's up-front choice for one self-contained change and commit authorization.
[Native task adapters](docs/worktree-transitions.md) own the entry, resume, return, and cleanup procedures for each harness, including conversation verification and unsupported modes.
They carry the current conversation into a new task and resume the saved task conversation for an existing one, without converting between harnesses.
The [shared continuation contract](docs/worktree-transitions.md#shared-continuation-contract) resumes already-requested work once after verified native completion, without new authorization.
Claude's interactive `/resume` still requires a subsequent `continue` message.
Creating a worktree through the standalone CLI does not move a running conversation; use the documented native transition.
This package does not install the former agentmemory or background publication services.
The commands never push automatically or clean merely because work ends.
Local delivery requires project checks and a verified fast-forward; provider review is a separate, explicitly requested workflow.
An explicit local delivery request also includes a native session return to the primary directory and safe worktree cleanup.
Cleanup also deletes the local task branch only when integrated into the recorded local target; incomplete transitions retain the worktree, and incomplete branch deletion is reported separately.
GitHub delivery retains the branch and worktree for a separately authorized PR workflow.
Dated historical decision records may describe retired experiments; they are not part of this package.

## Build and verify

Use the mise-managed tools declared in `mise.toml` directly; do not install tools as a testing side effect.
Bun, Node, Python 3.11.4, Rust, ShellCheck, and language servers have fixed versions; Pi is a separately installed prerequisite, not declared in `mise.toml`.
Python 3.11.4 is compiled from source when missing because no attested prebuilt artifact is available for that version.
The npm backend uses npm rather than selecting a package manager implicitly.
Provision missing tools explicitly with `mise install` before development.
That command uses active configuration, including global tools and the shared language servers; review the selection before running it.
Install and update Pi separately using your preferred package manager, such as Homebrew on macOS or AUR on Arch Linux.
Build/test SDK discovery and footer bundling use the first executable `pi` on an absolute PATH entry, skipping mise shims without invoking mise or Pi during discovery.
Discovery follows CLI symlinks and supported launchers to locate the installed SDK and terminal helpers, without assuming a package-manager-specific location.
Missing Pi produces installation guidance; builds/tests never provision or update it, and the toolchain does not pin its version.
Restricted reviewers discover their native executable independently on absolute PATH entries, also skipping mise Pi shims while preserving reviewed-source exclusions.
Removing the project declaration does not uninstall an existing mise Pi or remove its shim; any previously installed copy needs separate cleanup after this change is integrated.

```sh
make build
make lint
make test
```

`make build` creates the Pi guard, status-footer, worktree, and LSP bundles, the shared catalogue's Claude plugin projection, and Rust release binaries; it **does not provision tools or install harness resources**.
Cargo build, test, and lint commands retain `--locked` but may fetch missing dependencies from the network.
The guard-parser build likewise restores frozen Bun library dependencies with lifecycle scripts disabled and regenerates the local WASM/runtime/license assets in `guard/vendor/`.
`package.json` and `bun.lock` pin web-tree-sitter and tree-sitter-bash; ordinary harness execution needs neither network access nor `node_modules` for parsing.
Restricted-reviewer offline flags and synthetic-provider isolation are unchanged.
`make lint` checks that generated Claude LSP definitions still match the catalogue.
Tests use disposable homes and fake providers, not the live harness state.
Use the [focused test targets](test/README.md#focused-checks) during iteration instead of rerunning unrelated suites; `make test` and the commit hook still run the complete gate.
WT parity uses at most four isolated case workers; `WT_TEST_JOBS=1` selects serial execution without changing coverage.
The Pi and native Claude runtime files each run separately with at most two concurrent cases; those groups never overlap, and other Bun tests and browser integration stay serial.

## Install

After a disposable-home rehearsal and **separate approval for a live home**, run:

```sh
./install.sh
```

`install.sh` runs `mise install` and then `mise exec -- make build` in its own checkout before ownership validation, link placement, settings merging, and rollback.
It works when invoked by path from another directory and stops before resource installation if provisioning or building fails, preserving that command's exit status.
It requires Bash, mise, jq, GNU coreutils on PATH, make, iconv, and find; it does not provision these platform prerequisites.
Mise provisions active configured tools, including global tools and language servers; Cargo and Bun may download locked build dependencies.
Provisioning/build caches are not rolled back by the later resource transaction.
Missing prerequisites produce a clear error before provisioning, building, or installing resources.
The system find on macOS is supported; GNU findutils is not required.
Run `./install.sh --help` for help without building or installing; other arguments, including the retired `--force`, are rejected before effects.
The destination is the absolute `HOME` directory, not the caller's working directory; installation into the configuration source is refused.
Use a disposable `HOME` for rehearsals; automated installer fixtures replace mise and build commands so they never provision tools.
Real provisioning or installer rehearsals require separate approval and an explicit choice of isolated mise state and caches.
`make build`, `make lint`, and `make test` never install into the live home; installation remains a separate explicit action.

JSON-only filters and the package catalogue live under `tools/install/`; they do not perform installation or filesystem changes.
Settings retain unrelated fields, exact unknown numeric tokens, and existing permissions; duplicate JSON keys, redirected files, and unrecorded collisions are refused.
Only exact generated executable paths in the installer catalogue allow multiple hard links, as Cargo may link release binaries to hashed artifacts.
Those executables still require safe parents, a bounded regular non-symlink file, and execute permission; source/support resources and settings retain single-link checks.
The installer switches only declared links and settings and records ownership privately under `~/.local/state/ai-config/installation.json`.
An atomic `install.lock.d` directory serializes transactions; an existing lock is never automatically broken.
Handled failures restore completed changes only when their current bytes, targets, and modes still match the transaction.
Concurrent edits or incomplete rollback retain private recovery files and the lock for human inspection.
This is not crash-atomic installation: after an uncatchable termination, inspect the lock's `workspace` reference and saved transaction before manually recovering; do not simply delete the lock and retry.
The generic `evaluation` and `ai-config` executables, Rust installation library, WT Python installer, and one-time unrecorded adoption mode are retired.
Version-one and version-two ownership-record upgrades remain supported; matching but unrecorded resources are still refused.
See [the adoption decision](docs/adr/0041-retire-unrecorded-installation-adoption.md) and [coverage migration](test/installer-migration.md).
Other checkouts may retain stale compiled installation binaries; do not run them alongside `install.sh` or treat source retirement as live cleanup.
A Git revert cannot retarget already installed links; recovery needs another explicit operation.
Do not run the removed legacy installer, delete `pi-evaluation`, stage, commit, push, or change the parent submodule pointer by implication.
