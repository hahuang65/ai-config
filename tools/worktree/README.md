# Worktree — small, persistent task worktrees

Agents use `worktree`; the installed shell shortcut is `wt`.
The replacement installer also provides the `worktree` alias for that same Rust executable.
Compatibility identifiers such as `wt.*`, `WT_ROOT`, and ownership records remain unchanged.

Start each task in its own Git worktree, keep it as long as needed, and remove it after its work is integrated.
There is no pool, background cleanup, automatic expiry, or dependency installation.
Orchard is not required and existing Orchard worktrees are left alone.

## Rust migration

The user approved a Rust rewrite, recorded in [ADR 0002](docs/adr/0002-reimplement-the-cli-in-rust.md).
The Rust implementation is built in this checkout; installing or switching the ai-config source is a separate explicit operation.
The previous Python implementation remains as a compatibility reference.
Shared regression tests track deliberate behavior changes, including removal of the legacy PID-based session-lock exception.
Rust 1.99.0 is pinned through mise.
The Rust checks cover existing command behavior, saved ownership-record compatibility, and cleanup safety.

## Install

Requires Git and macOS or Linux at runtime, plus the mise-managed Rust toolchain to build.
Python 3.11.4 is the reference interpreter for the retained exact-output compatibility tests.
Newer Python releases change argument parsing and diagnostics; they are not interchangeable test references.
The installed Rust command has no Python dependency.
See [verification notes](docs/testing.md) for the Linux filename evidence and test prerequisites.
GitHub cleanup also requires an authenticated `gh` CLI.
Use your mise-managed tools directly.

```sh
cd /path/to/ai-config
make build
make test
```

The component Makefile never installs or removes links.
Only the package-root `./install.sh`, run with separate live-home approval, owns installation into `~/.local/bin/wt` and refuses unrelated paths.
It builds that checkout and records ownership itself; the standalone Python installer is retired.
Keep the selected source checkout available; do not remove existing launchers outside the package ownership operation.
Cargo resolves pinned build dependencies from `Cargo.lock`; the installed executable needs no Python or Node runtime.
No shell startup changes or background services are installed.

## Use

From a project with an initial commit:

```sh
wt new invoice-search
cd -- "$(wt enter invoice-search)"
wt list
wt clean invoice-search --check
wt clean invoice-search
```

`new` first prints existing worktrees to standard error as a cleanup reminder.
It creates `~/.worktrees/<project>/<task>` on `<initials>/<task>` and prints the path to standard output.
Initials come from Git's user name unless `wt.initials` is set.
It never switches or changes files in the main checkout.
A command cannot change its parent shell's directory; use `cd` as shown, or the Pi adapter.

`enter` prints an existing managed task's path.
An explicitly Git-locked task is not entered by this standalone command; inspect its lock reason before changing that protection.
Native session transitions do not acquire or release Git locks.

`list` shows this project's registered Git worktrees, including unmanaged ones.
For a submodule, the main checkout is its working directory, not the administrative directory under the parent repository's `.git/modules`.
Listing and return-before-cleanup use that working directory without changing the parent repository.
A missing main checkout stops the operation; a linked task cannot replace it.
It does not contact GitHub.
The default limit is 50; use `--all` for every worktree.

`clean TASK` verifies and removes one task.
`clean` checks all managed tasks, removes eligible ones, and reports why others remain.
`--check` never removes anything.
If invoked inside the worktree being removed, cleanup requests a return to the main checkout instead of deleting the current directory.
Return through the harness's native controls before cleanup; the native cleanup flow can perform both steps under one explicit cleanup or local delivery request.
After removing the worktree, WT deletes the local task branch only when its exact tip is integrated into the recorded local integration branch.
A squash-merged PR can permit worktree removal without permitting local branch deletion.
No remote branch is deleted, and branch deletion is never forced.
Successful removal adds `branchRemoved` to JSON output; retained branches include `branchReason`.
If branch deletion fails after worktree removal, `cleanupIncomplete` is true and the command exits nonzero, preserving the branch and reporting the partial result.

All commands support `--json` for protocol-version-1 output.
Diagnostics stay on standard error.
Exit codes are 0 for success, 1 for an operational failure or incomplete single/batch cleanup, 2 for invalid arguments, and 130 for interruption.
A successful empty batch explicitly reports zero managed tasks.

## Starting branch

The remote's symbolic default branch identifies the integration branch.
If that is missing, run `git remote set-head origin -a` yourself or configure `wt.base`.
Local-only repositories use `main` or `master` when unambiguous.

Creation fetches the configured integration branch before choosing its exact starting commit.
A local branch ahead of the remote is preserved; divergent branches require an explicit choice.
Fetch failure stops creation.
Use `--local` only when you deliberately want local history without a fetch.
Use `--base REF` for dependent work; this changes the starting commit, not the cleanup destination.
WT does not reset branches, move existing changes, initialize submodules, or install dependencies.

## Project settings

These optional Git settings keep normal commands short:

```sh
git config wt.base main
git config wt.remote origin
git config wt.initials hh
git config wt.project unique-project-name
git config wt.delivery local
# For projects completed through GitHub pull requests instead:
git config wt.delivery github
```

The default delivery mode is `local`, except for A5 repositories classified by effective global or system `ai.projectFamily=a5`, which use `github`.
Repository-local classification cannot grant A5 status.
An explicit `wt.delivery` setting selects the workflow without any dependency on Orchard settings.
For project-name collisions, set a unique `wt.project`; WT never adopts another repository's directory.
Set `WT_ROOT` only when you intentionally want a different worktree root, such as in tests.
Do not change naming or root settings while managed tasks remain without first moving or cleaning those tasks deliberately.

## Cleanup safety

Local mode requires the task's exact HEAD to be an ancestor of the local integration branch.
GitHub mode requires a merged pull request whose head commit, source repository, branch, destination repository, and integration branch match the task.
This supports squash and rebase merges without treating a merely closed PR as integrated.
New commits after a PR merge prevent cleanup.
Fork-based PRs are not currently supported; they fail closed.
The GitHub query is read-only and bounded to 100 matching closed PRs; no match retains the task.

Modified tracked files, non-ignored untracked files, in-progress Git operations, changed task branches, and locks prevent removal.
Ignored files are deliberately disposable, including dependencies, generated files, and local ignored configuration.
No ignored file content is inspected to make that decision.
Git rechecks dirtiness and locks during removal, which never uses `--force`.
Nested submodules or concurrent external Git changes may cause removal to fail; inspect the retained worktree rather than forcing it.

WT serializes its own operations with a short-lived OS file lock.
Git's inventory remains the list of worktrees; a small record in each Git administrative directory identifies WT ownership and the selected integration policy.
There is no global task database or watcher.
WT cannot detect every external editor or shell writing into a worktree.
Stop other work before requesting cleanup.
WT's `session` protocol stores separate Pi and Claude conversation references, with no session claims, PID tracking, or session locks.
The harness adapter, not WT, moves or resumes conversations.
An existing Git lock is explicit protection; inspect its reason before manually running `git worktree unlock PATH`.
WT does not reclaim locks automatically.

## Harness sessions

The AI package installs native Pi and Claude adapters alongside the Rust `wt` and `worktree` commands.
See [native task transitions](../../docs/worktree-transitions.md) for carrying a conversation into a new task, resuming a saved task, and destination checks.
`wt session --help` describes the JSON-only adapter protocol.
Standalone `new` and `enter` still only print paths; they cannot change a running session.
The harness command `/wt leave` returns to the primary directory with conversation continuity but without removing the task or branch.
Pi's `/wt clean TASK` verifies a native return before cleanup; Claude uses native `ExitWorktree` with `keep` followed by WT cleanup.
An explicit local delivery request includes this sequence only after successful integration.
WT does not alter Herdr configuration or migrate its sessions.

## Limits and recovery

Worktrees require an initial project commit.
WT never creates that commit on your behalf.
A failure after Git creates a worktree leaves it available for inspection instead of trying destructive rollback.
If its ownership record could not be saved, the worktree remains visible as unmanaged.
Use `git worktree list` to inspect it; resolve it manually before retrying the same task name.
Deleting repositories, migrating tasks, delivery orchestration, and prepared dependency pools are outside this tool's scope.
