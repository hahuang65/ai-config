# WT verification

## Reference toolchain

Use mise-managed Rust 1.99.0 and Python 3.11.4 for the full gate.
Python is a compatibility-test dependency, not a WT runtime dependency.
The tests compare Rust output and exit status with the retained Python implementation.
Python 3.11.17 changes the handling of `list -hfoo`; Python 3.12.15 also changes option termination and diagnostic formatting.
These interpreter changes produce parity failures without a WT source change.
Do not weaken assertions or change the installed Rust command to follow the host interpreter.

```sh
python --version
rustc --version
make test
make lint
```

## Parity scheduling

The package's `make test-worktree` and this component's `make rust-test` run the complete selected parity suite with four spawned worker processes by default.
Set `WT_TEST_JOBS=1` for serial execution, or 2–4 for bounded parallelism.
Direct invocation supports the same bound: `python tests/rust_parity.py --jobs 1` from this component directory.
Cases retain their isolated temporary repositories, assertion logic, and environment-dependent skips.
Reporting remains ordered by case, and a failing case or crashed worker fails the gate.
The runner tests use synthetic outcomes; they do not invoke a real provider or alter the installed CLI.
See the [package test guide](../../../test/README.md#focused-checks) for focused targets and full-gate boundaries.

## Python-driven repository fixtures

`tests/repository_fixture.py` retains the two pristine repository shapes used by the executable cases: an empty initial commit and an initial commit containing `.gitignore`.
Each serial invocation or spawned worker owns one cache, populated only after successful initialization and capture.
A cache holds at most two immutable snapshots, each limited to 128 entries and 256 KiB of file contents; it retains no seed directories or open handles.
Every case gets independent files, permissions, refs, objects, index, and working tree, without hardlinks or mutable sharing.
Only the initial seed commit disables automatic maintenance through command-local Git options; later commands and copied configuration are unchanged.
Capture refuses active locks, non-regular entries, and oversized snapshots; a failed capture is not cached.
The original environment setup, case bodies, subprocess deadlines, and skips are unchanged, with no persistent cache or cached test outcomes.
Five fixture regressions run in the same bounded parity pool alongside the original 83 cases; they do not create nested worker pools.
They check fresh-process reuse, copy isolation and permissions, empty destinations, cache bounds, seed quiescence, and recovery after rejected captures.
Run them alone with `python -m unittest discover -s tests -p rust_test_repository.py -v` from this component directory.

## Rust integration scheduling

`tests/cli.rs` includes the cleanup, session, and branch-validation cases from `tests/cases/` in one integration binary.
Rust's normal test-thread scheduler can therefore overlap these independent cases instead of Cargo running two integration binaries sequentially.
Each case still owns its disposable repositories and worktrees; no mutable fixture is shared.
The common initial Git commit is captured once as immutable in-memory bytes per test process, with independent files and permissions restored for every fixture.
Seed-building Git commands disable automatic maintenance so transient maintenance locks cannot enter the snapshot; production Git behavior is unchanged.
An isolation regression checks that changes to one fixture's config, refs, and files cannot affect a later fixture.
There is no persistent fixture cache or cached test result.
Use `cargo test --locked --offline --test cli cleanup::` or `--test cli sessions::` from this component directory to select one group.
Use `cargo test --locked --offline --test cli -- --test-threads=1` for serial diagnosis.

## Bash completion

`tests/cases/completions.rs` runs the Rust-produced setup in clean Bash processes with disposable homes.
Cases cover both installed names, executable paths with spaces, current-project task names, option positions, `--`, literal shell metacharacters, quiet failures, and managed names beyond the list display limit.
A held WT operation lock, file-content/modification-time snapshots, and Git process traces check that completion does not lock, mutate, fetch, or invoke cleanup.
The retained Python oracle gains only the help note identifying the Rust-only setup command; its lifecycle assertions remain unchanged.
The component lint gate syntax-checks and ShellChecks the embedded Bash source.

```sh
cargo test --locked --test cli completions::
```

## Branch-syntax reuse

A repository object reuses successful `git check-ref-format` results only for its own fixed checkout root and lifetime within one WT invocation.
The cache holds at most 64 names, each at most 1,024 bytes; additional or longer names still use Git normally rather than being rejected.
Rejected names and operational errors are never remembered, and a cache hit still checks interruption.
The cache disappears with the repository object; nothing is persisted or reused by a later CLI process.
This caches syntax only: branch existence, worktree inventory, ownership records, and conversation bindings are still checked from current evidence.
The CLI regression traces real Git processes to verify one check per repeated name and new checks in the next invocation.
Unit regressions cover capacity and byte-length bounds, error/rejection retries, and changed ownership metadata after warming syntax results.
Run `cargo test --locked --offline --bin wt branch_name_tests` and `cargo test --locked --offline --test cli branch_validation::` from this component directory.

## Subprocess deadlines

The inherited-pipe and cancellation tests use a 100ms internal timeout; production callers keep their existing whole-second deadlines.
The cancellation fixture records that its descendant started, schedules a write after 200ms, and observes for another 200ms after cancellation to detect an escaped writer.
These remain real subprocess/process-group checks, not simulated clock tests.
The process cases live in `tests/support/process.rs` and run as unit tests of the production runner.
Successful/failed leader-exit fixtures wait for descendant readiness, schedule a write after 100ms, and use a 200ms observation window.
All of these durations are named constants indexed in the [test-duration tuning checklist](../../../test/timings.md).

## Fixture isolation

The ownership-byte fixture uses `tempfile` to allocate its directory atomically.
A deterministic regression creates two fixtures with the same name prefix and verifies that removing one does not remove the other's files.
It failed with `AlreadyExists` before the fix.
The existing ownership-byte assertions and normal parallel test execution remain unchanged.
The new test adds one Rust case and less than one second to a warm run.

```sh
cargo test --locked ownership -- --test-threads=8
```

## Submodule checkout identity

Two Rust executable cases cover a submodule whose administrative name differs from its checkout name.
They verify listing, task naming, entry, return-before-cleanup, retained branches, and an unchanged parent repository.
A missing main checkout must stop listing and cleanup rather than adopting the current task as the main checkout.
These are corrected Rust behaviors; the retained Python reference is unchanged.
The cases add about four seconds to a warm macOS gate and require no network.

## Platform evidence

On 2026-10-08, the macOS gate passed 152 WT tests with two explicit filename skips.
The complete Pi evaluation gate using this WT change passed 486 tests with the same two skips.
Formatting and strict Clippy passed.

A separate Linux ARM64 container ran the full WT gate with Rust 1.99.0, Python 3.11.4, and Git 2.47.3.
All 154 WT tests passed: 58 retained Python cases, 13 Rust cases, and 83 Rust executable cases.
There were no Linux skips, and formatting and strict Clippy passed.
Both non-UTF-8 filename cases ran successfully, including ownership, entry, listing, cleanup, and branch retention beneath a non-UTF-8 parent.
This closes the missing Linux evidence; macOS still cannot create those filenames.

The container received selected source files through an archive, not host credentials, configuration, Git metadata, or worktree mounts.
Mise compiled Python 3.11.4 from source because the old prebuilt artifact has no GitHub attestation.
Attestation verification was not disabled.
These results cover WT on Linux, not the complete Pi, Herdr, and Firefox evaluation on Linux.
