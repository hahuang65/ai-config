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
It does not preserve private docs; do not use it for ordinary task cleanup.
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
cd -- "$(command wt enter invoice-search)"
wt list
wt clean invoice-search --check
wt clean invoice-search
```

`new` first prints existing worktrees to standard error as a cleanup reminder.
It creates `~/.worktrees/<project>/<task>` on `<initials>/<task>` and prints the path to standard output.
Initials come from Git's user name unless `wt.initials` is set.
It never switches or changes files in the main checkout.
The executable cannot change its parent shell's directory; use `cd` as shown, the opt-in Bash integration below, or the Pi adapter.

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
`--check` never copies or removes anything.
If invoked inside the worktree being removed, cleanup requests a return to the main checkout instead of deleting the current directory.
Return through the harness's native controls before cleanup; the native cleanup flow can perform both steps under one explicit cleanup or local delivery request.
After removing the worktree, WT deletes the local task branch when its exact tip is integrated into the recorded local integration branch.
For squash and rebase merges, an exact-head merged PR plus synchronized, matching-tree proof also permits branch deletion.
GitHub-mode cleanup without that local proof still removes only the worktree and retains the branch.
No remote branch is deleted, and branch deletion is never forced.
Successful removal adds `branchRemoved` to JSON output; retained branches include `branchReason`.
When private docs exist, checks include `docsToPreserve` and successful removal includes `docsPreserved`, both file counts.
Human output distinguishes planned preservation from verified copies in the primary checkout.
If branch deletion fails after worktree removal, `cleanupIncomplete` is true and the command exits nonzero, preserving the branch and reporting the partial result.

All lifecycle commands support `--json` for protocol-version-1 output.
Diagnostics stay on standard error.
Exit codes are 0 for success, 1 for an operational failure or incomplete single/batch cleanup, 2 for invalid arguments, and 130 for interruption.
A successful empty batch explicitly reports zero managed tasks.

## Bash directory switching

Enable directory switching for the current Bash shell:

```bash
source <(wt shell-init bash)
wt enter invoice-search
# The same shell now runs in the selected worktree.
```

This defines shell functions for both `wt` and `worktree`.
Only successful plain `enter TASK` changes directory, using Bash's built-in `cd` with the returned path as literal data.
It prints no path on successful entry.
`--json`, help, errors, and every other subcommand pass through to the executable without changing directory.
In particular, `new` still creates a worktree without entering it, and cleanup behavior is unchanged.
Git locks and normal entry validation remain effective.

Use `command wt enter TASK` or `command worktree enter TASK` to bypass the function and print the path.
The `cd -- "$(command wt enter TASK)"` idiom therefore works with or without the integration.
Machine consumers and harness adapters can keep invoking the executable directly.
Shell functions cannot change an already-running harness session; use its native transition controls instead.

The setup command works outside a Git repository and changes no files or settings.
It is separate from completion setup and supports Bash only.

Package installation also owns `~/.local/share/ai-config/bash/wt.bash`, a link to the same function source.
Independently managed Bash configuration can load this installed fragment without invoking WT during startup:

```bash
if [[ -x "$HOME/.local/bin/wt" &&
      -r "$HOME/.local/share/ai-config/bash/wt.bash" ]]; then
  source "$HOME/.local/share/ai-config/bash/wt.bash"
fi
```

With that loader in place, installation makes the functions available in new shells, and missing files are silently ignored.
Existing shells still need to source the fragment or run the manual setup command.
The installer owns only its fragment link, preserving unrelated files and recorded ownership through upgrades and rollback.
It never edits shell startup files or adds a loader to another repository.

## Bash completion

Package installation places owned links at `~/.local/share/bash-completion/completions/wt` and `worktree`.
An existing `bash-completion` loader discovers either command's entry on demand in future Bash sessions.
The installer preserves personal completion files, refuses unrecorded collisions, and does not edit Bash startup files or install the optional `bash-completion` package.

For an already-open shell, or without a `bash-completion` loader, the Rust CLI prints manual setup for both names:

```bash
source <(wt completions bash)
```

Run this in Bash after building and selecting the updated executable.
Without `bash-completion`, add the same line to your Bash startup file if you want future shells to enable it.
The setup command itself does not install anything.
Manual setup requires no bash-completion package, Python, jq, or additional runtime service.
Other shells are not currently supported.

Completion offers public subcommands and managed task names, not flags.
For `wt enter fe<TAB>` and `wt clean fe<TAB>`, it reads the current project's managed task names and matches the literal prefix.
Names still complete after typed flags such as `--json` or `--check`, and after `--`.
Flags remain valid command arguments but are never suggested.
Unmanaged worktrees are not suggested, and the normal `wt list` 50-entry display limit does not hide matching managed tasks.
Suggestions do not bypass entry or cleanup safety checks.
`new` task names stay free text; starting-revision completion for `new --base` is not included.

Task completion reads current Git inventory and ownership records without fetching, creating worktrees, taking the WT operation lock, or changing repository state.
It works from a main checkout or a linked task, with no persistent completion cache.
Outside a usable repository, task-name completion returns no suggestions or diagnostics.
Subcommand completion remains available without a repository.
The printed Bash function uses the internal `__complete` callback; it is not an agent workflow or another installed executable.
Callback arguments are bounded to 256 values and 32 KiB in total, with invalid contexts silently returning no candidates.

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

Local mode normally requires the task's exact HEAD to be an ancestor of the local integration branch.
If ancestry does not hold, local mode can instead use the synchronized merged-PR proof below.
GitHub mode requires a merged pull request whose head commit, source repository, branch, destination repository, and integration branch match the task.
This supports squash and rebase merges without treating a merely closed PR as integrated.
New commits after a PR merge prevent cleanup.
Fork-based PRs are not currently supported; they fail closed.
The GitHub query is read-only and bounded to 100 matching closed PRs; no match retains the task.

For full cleanup after a squash or rebase merge, all of these conditions must hold:

- The exact task tip has a matching merged GitHub PR as described above.
- The recorded local integration branch and its remote-tracking branch have the same commit.
- A bounded, read-only `git ls-remote` query confirms that the remote still advertises that exact commit.
- The task tip and integration commit have identical Git trees, including file modes and submodule references.

WT does not fetch or advance the integration branch during cleanup.
Fetch and fast-forward it explicitly before retrying a synchronization refusal.
This proof uses the task's recorded remote and integration branch, not an unrelated branch upstream.
WT rechecks synchronized evidence and the task identity before worktree removal, then rechecks proof before compare-and-delete branch removal.
A failed post-removal recheck retains the branch and reports partial cleanup.
GitHub-mode cleanup without synchronized proof retains its existing worktree-only behavior.
Local mode without either ancestry or synchronized merged-PR proof retains both the worktree and branch.

Modified tracked files, non-ignored untracked files, in-progress Git operations, changed task branches, and locks prevent removal.
This includes non-ignored untracked docs; cleanup and native return have no docs exception.
Before otherwise-safe removal, WT copies ignored regular `docs/` files into the primary checkout at the same relative paths.
It skips tracked docs, never overwrites existing files, and verifies copies byte-for-byte.
An identical existing file is left unchanged; a different file stops cleanup before copying.
Symlinks, special files, and nested Git metadata under `docs/` require manual preservation.
Copy or verification failure retains the task; copies already made can remain in primary and are never staged.
WT rechecks integration and working state after copying, then uses ordinary `git worktree remove` without `--force`.
It does not unlink individual source docs, quarantine the task, or audit unrelated ignored directories.
Other ignored files remain disposable; their contents are not inspected for preservation.
Use ordinary local checkout directories, not bind-mounted aliases of the task's files.
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
