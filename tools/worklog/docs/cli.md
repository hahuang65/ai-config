# Worklog CLI contract

Worklog records local reminders and work history without a registration step.
Agents resolve `tools/worklog/target/release/wl` through the root Worklog skill; `wl` below is the installed shell shortcut to the same Rust executable.
It does not start suggested tasks, schedule work, expire reminders, or infer completion from a commit.
All writes are noninteractive.
Use only short, nonsensitive summaries, not transcripts, credentials, environment dumps, or customer data.

## Build and storage

The repository pins Rust through mise.
Run `make build` to produce `target/release/wl`.
Run `make test` for the process-level CLI integration suite.
The component Makefile does not install or remove links.
For a separately approved installation or source switch, run the package-root `./install.sh` to build the selected checkout and install the owned link into `~/.local/bin/wl`.

The default store is `$HOME/.worklog/`, not the source repository or invocation directory.
Without an override, `HOME` must be nonempty and absolute; invalid values fail before storage access.
Set `WL_ROOT` to an absolute directory path to use a separate store, independently of `HOME`.
The parent directory must already exist.
Queries do not create a store.
The CLI does not access or migrate the existing Work log.
Source import, builds, and installation do not move standalone WL records.

Use a private directory on a local filesystem that supports advisory locks, hard links, and directory synchronization.
New store directories have mode `0700`, and new files have mode `0600` on Unix.
Existing directory permissions remain the caller's responsibility.
Store roots, event directories, event files, lock files, and pending files must not be symbolic links.
The store is for one trusted local user, not for hostile concurrent filesystem access or a shared network filesystem.

## Project selection

The current directory selects the Git project by default.
All subdirectories and worktrees of that repository share its project identity.
Use exactly one explicit scope option when needed:

- `--project-path PATH`: discover the Git project at this path, even if it has no history.
- `--project NAME_OR_ID`: select a known readable name or exact canonical ID from `wl projects`.
- `--unassigned`: explicitly select work without a project.
- `--all-projects`: query all projects and unassigned work with `list` or `history`.

A named project takes precedence over the current directory.
Unknown and ambiguous names fail instead of selecting a project by guesswork.
Use `projects --all` to obtain exact IDs, or use `--project-path` to resolve ambiguity.
Task and entry IDs do not bypass project selection.
For example, changing an unassigned task requires `--unassigned` on that command too.
Project-level progress and commits require a project; unassigned progress must refer to a task.

An origin URL defines the canonical identity when it exists.
WL accepts HTTPS, HTTP, SSH, Git, SCP-style SSH, file URLs, and existing local origin paths.
Network origins use `origin:HOST[:PORT]/PATH`, without user information, query, fragment, the transport's default port, or one trailing `.git` suffix.
For example, `app.git` and `app.git.git` identify different projects: `app` and `app.git`.
Transport variants such as `git@example.invalid:team/app.git` and `https://example.invalid/team/app.git` share an ID.
Repository path case remains significant.
Local origins use their canonical filesystem path.
A relative local origin resolves from the primary checkout, so linked worktrees retain the same identity.
If repository metadata cannot identify that checkout, such as a linked worktree with a separate Git directory and no recorded `core.worktree`, discovery fails rather than assigning a different project; select a known exact ID with `--project` or use `--project-path` on the primary checkout.
Without an origin, the canonical common Git directory defines a `local:` identity.
The readable name comes from the origin repository basename, or from the common repository directory.

Only local Git commands run; WL does not contact remotes or invoke credential helpers.
Each Git command has a three-second deadline and bounded captured output.
Origin parse failures do not echo the origin.
Changing or adding an origin can change a project's identity.
Existing entries retain their recorded identity; WL does not guess identity migrations.

## Write commands

```sh
wl note 'Check report totals'
wl note 'Check another project' --project other
wl note 'Choose a project later' --unassigned
wl start 'Investigate report totals'
wl start --task 1
wl progress 'Agreed on the calculation' --task 1
wl progress 'Compared two project designs'
wl commit --task 1 --hash abcdef0 --subject 'Add calculation'
wl complete 1 --summary 'Report totals verified'
wl complete 1 --hash abcdef0 --subject 'Finish report totals'
wl abandon 1 --summary 'No longer needed'
wl correct 1 --text 'Check the monthly report totals'
wl correct 4 --hash 1234567 --subject 'Correct commit subject'
```

Examples show alternatives, not a sequence to run against one task.
Every successful write returns the newly appended entry.
Entry IDs are positive integers that increase across the whole store.
A task's ID is the ID of its initial `note` or new-task `start` entry.
Commit hashes must contain 7 to 64 hexadecimal characters; WL does not verify that the commit exists.
`--hash` and `--subject` must appear together.
Text must be nonblank, single-line, free of control characters, and no more than 2048 UTF-8 bytes.

### Task states

- `note TITLE` creates a `planned` task.
- `start TITLE` creates an `active` task.
- `start --task ID` changes a `planned` task to `active`.
- `progress` and `commit` leave the task state unchanged.
- `complete ID` changes a planned or active task to `completed`.
- `abandon ID --summary TEXT` changes a planned or active task to `abandoned`.

Completed and abandoned tasks cannot restart or receive new progress, commits, or lifecycle transitions.
Corrections remain allowed after closure.
A completion with commit metadata produces one entry, not a separate commit entry.
No command auto-starts another task.
After completion, `wl list --state planned --limit 1` selects the oldest planned reminder in the current project without changing it.

### Corrections

`correct ENTRY_ID --text TEXT` appends a replacement interpretation of an original entry's text.
For a task's initial entry, this changes its title in derived lists.
For progress, completion, and abandonment entries, it corrects the summary.
Use `--hash` with `--subject` to replace commit metadata on an entry that already has commit metadata.
A commit-only entry's text follows a replacement commit subject unless `--text` is also supplied.
A correction retains any field not replaced by its arguments.

Corrections must target the original entry, not another correction.
The last appended correction to an original entry takes precedence.
A correction cannot move work between projects, change an entry's kind, change its task association, reopen a task, or add commit metadata to an entry that had none.
No command edits or deletes an original entry.

## Query commands

```sh
wl list
wl list --state planned --project other
wl list --state all --all-projects --all
wl history --task 1
wl history --since 2026-01-01 --until 2026-01-31 --all-projects
wl projects --all
```

`list` returns derived tasks, with planned and active tasks selected by default.
`--state` accepts `open`, `planned`, `active`, `completed`, `abandoned`, or `all`.
Task rows appear in initial entry order, oldest first.
`history` returns entries in append order, including completed and abandoned work and all correction entries.
`--since` and `--until` select inclusive UTC calendar dates in `YYYY-MM-DD` format.
This period view supplies dated entries for summaries; WL does not generate a prose summary.

History retains original `text` and `commit` fields and adds `effective_text` and `effective_commit` with the latest interpretation.
Corrections apply before period filtering, including corrections recorded after the queried period.
Text output also identifies corrected original values.
`projects` returns unique project IDs and their readable names, ordered by name and then ID.
It accepts no scope option and excludes unassigned work.

Every collection defaults to at most 20 rows.
Use `--limit N` for 1 to 10000 rows, or `--all` for every matching row.
`--all` cannot be combined with `--limit`.
`--all` changes only the row limit, not the selected project or task states.
Every response reports the matching `total` and the number `omitted`.
Empty results are successful responses with zero rows, zero total, and zero omitted.

## Automation and errors

`--help`, command-specific `--help`, and `--version` are available.
Add `--json` before or after the command for one compact JSON object on stdout.
A write response has the shape `{"entry": {...}}`.
A query response has the shape `{"items": [...], "total": 0, "omitted": 0}`.
Entry fields are `schema`, `id`, `at`, `project`, `task`, `kind`, `text`, `commit`, and `corrects`.
A project has `id` and `name`; commit metadata has `hash` and `subject`.
Optional fields use JSON `null`.
Task rows contain `id`, `project`, `title`, `state`, and `created_at`.
Timestamps are RFC 3339 UTC strings; IDs, not wall-clock time, define append order.

Diagnostics go to stderr, including in JSON mode.
Exit code `0` means success, `2` means invalid arguments or a domain validation failure, and `1` means an operational storage or output failure.
Unknown options, extra arguments, conflicting options, and invalid transitions fail without appending an entry.
Arguments and a preflight snapshot are validated before a store is created.
Lifecycle rules are checked again under the write lock.
A failed transition during a concurrent race can leave initialized storage, but it cannot append the rejected entry.
Errors never include stored record contents, Git command output, or environment dumps.
Normal argument-parser errors can repeat the rejected argument, so do not put secrets in arguments.

## Atomic append and recovery

The store uses immutable JSON files in `events/`, with one fixed-width numeric filename per entry.
After preflight validation and before taking the write lock, every writer synchronizes the store's parent directory, even if the store already exists or another writer creates it first.
If this synchronization fails, the writer stops without publishing an entry.
A writer takes the operating system's exclusive advisory lock on `.lock` and waits no more than three seconds.
The operating system releases the lock when the process exits, including after a crash.
Do not remove the lock file to clear contention.

Under the lock, WL reloads history, checks the new entry, writes and synchronizes `.pending`, and atomically publishes a hard link in `events/` without replacing an existing path.
It then synchronizes the event directory, removes `.pending`, and synchronizes the store directory.
Readers see only published, complete event files.
A pending file left by an interrupted write is ignored by readers and removed by the next valid writer.
A crash after publication does not cause the pending entry to be published twice.
Malformed, oversized, or nonconsecutive published entries stop reads and writes rather than being silently removed.

There is no automatic write retry and no operation-ID or deduplication interface.
If a process is interrupted, output fails, or durability confirmation fails after publication, inspect `history` before retrying.
Repeated capture commands intentionally create distinct entries.
History is replayed on each invocation; this small local log has no database, background worker, or cache.
Back up the store if its history is needed beyond this evaluation.
