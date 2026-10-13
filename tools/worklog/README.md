# Worklog

A bundled Rust CLI for short-term reminders and append-only work history.
Agents invoke `tools/worklog/target/release/wl` through the root `skills/work-log/` instructions; the installed shell shortcut is `wl`.
Both use the same executable.
See [the domain model](CONTEXT.md), [the scope decision](docs/adr/0001-keep-a-small-append-only-work-log.md), and [the CLI reference](docs/cli.md).

## Build and installation

Rust 1.99.0 is pinned through mise.
Use the managed tools directly.

```sh
make test
make lint
```

The component Makefile does not install or remove links.
Only the package-root `tools/evaluation/target/release/ai-config --root "$(pwd -P)" install` operation installs `~/.local/bin/wl`, records ownership, and refuses unrelated existing paths.
Keep the selected source checkout available.
The default store is `~/.worklog/`, regardless of the source checkout or invoking project.
Set `WL_ROOT` to an absolute path for isolated tests or controlled cutover.
Read-only queries do not create a store; first writes create it privately.
No existing Work log history is imported or modified automatically.
Do not import or change a standalone Work log installation as part of this package.

## Use

```sh
wl note 'Check the report totals'
wl note 'Fix the parser' --project-path /path/to/other/repository
wl start --task 1
wl progress 'Agreed on the calculation' --task 1
wl commit --task 1 --hash abcdef0 --subject 'Add calculation'
wl complete 1 --hash 1234567 --subject 'Finish report totals'
wl list --state planned --limit 1
wl history --all-projects --since 2026-01-01 --until 2026-01-31
```

These examples illustrate alternatives; use the IDs returned by your own commands.
Add `--json` for machine output.
Use `--all` when you need every matching row; bounded responses report omitted counts.
Use known project names from `wl projects`, or an explicit repository path; ambiguous names are errors.
Use `--unassigned` only when deliberately noting work without a project.

Pi's minimal work-log skill recognizes clear later-work remarks and records semantic events.
After completion, it suggests the oldest unstarted reminder in the current project without starting it.
There is no scheduler or background monitor.
Long-term backlog tracking stays in Jira or GitHub.

## History and safety

Entries are appended, never edited or deleted by WL.
A correction adds a new entry and changes the interpretation used in lists and summaries.
Corrections support text and existing commit metadata, not project reassignment or lifecycle changes.
A finishing commit and task completion can be one entry; other commits do not imply completion.

Keep summaries short and free of secrets, transcripts, and private customer data.
Use private local storage; the log assumes one trusted local user and filesystem support for advisory locks, hard links, and directory synchronization.
Interrupted writes do not cause a partially written entry to appear as published history.
After an interrupted command, inspect history before retrying because publication may have succeeded before output was delivered.
See the CLI reference for exact durability, concurrency, and error behavior.

## Validation

All 24 process-level cases and three storage-sync tests pass, along with formatting and Clippy.
The tests cover identity across worktrees, unrelated projects with similar origin names, combined commit/completion, corrections, bounded queries, invalid input, concurrent writes, interrupted publication, private storage, and sync failures.
Sync sequencing is tested through injected filesystem operations; physical power-loss behavior is not claimed as tested.
