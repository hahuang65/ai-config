# Work log views

The `work-log` agent-facing CLI packages and initializes `work-log.sql` for every query.
Set `WORK_LOG_DIR` only for isolated tests or an intentional alternate host-local store.
The default store is `$XDG_DATA_HOME/work-log`, or `~/.local/share/work-log` when `XDG_DATA_HOME` is unset.

## Open work

Run `work-log open --json`.
This returns an envelope with `items`, `returned_count`, `total_count`, and `truncated` for the unordered collection of planned, active, and paused work across all repositories.
Collection commands return at most 100 items by default.
Use `--limit N` up to 1000 or explicit `--all` when complete output is necessary.
No priority or semantic ordering exists.

## Session digest

Run `work-log digest` from a Git repository.
This returns compact repository-scoped context: active and paused titles, due or overdue titles, and the count of other planned work.

## Timeline

Run:

```text
work-log timeline --from YYYY-MM-DD --to YYYY-MM-DD --json
```

This returns a bounded envelope of effective checkpoints in chronological order for the inclusive local date range.

## Period summary

Run:

```text
work-log summary --from YYYY-MM-DD --to YYYY-MM-DD
```

This renders completed and abandoned work grouped by repository, followed by universal Open work.

## Work-item state and history

Run `work-log item <work-item-id> --json` for current state and derived elapsed and active durations.
Run `work-log history <work-item-id> --json` for a bounded envelope containing the effective checkpoint sequence.

DuckDB definitions live in [work-log.sql](work-log.sql).
