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

## Repository-local file links

Rust process cases in `tests/cases/local_links.rs` and `local_links_safety.rs` check `wt.link` through the CLI.
They cover literal multiple entries, duplicate values, primary-checkout selection from linked tasks, shared edits, cleanup without source removal, and neighboring tracked files.
Global and included settings cannot opt a repository into links.
Unsafe paths, `.git` and `.terraform` components, missing or non-regular sources, source symlinks, tracked collisions, and incompatible starting revisions are refused before task creation.
Filesystem-gated case-insensitive regressions cover tracked-source aliases and starting-tree aliases, even with `core.ignoreCase=false`.
They must reject the alias before task or branch creation; filesystems that distinguish those names do not run these cases.
A post-checkout collision leaves a managed task, prints no successful receipt, and overwrites nothing.
A fake Terraform executable proves that neither Terraform nor a configured `wt.setup` command runs during creation.
The retained Python reference does not implement local links, so these cases remain Rust-only rather than changing parity expectations.
Unit regressions in `tests/support/local_link_identities.rs` count identity-metadata reads within each collision-validation pass, not wall-clock speed.
The original fixture read one path prefix 16 times; validation now reads each literal prefix once per pass and discards those observations afterward.
A changed-source test confirms that later validation and installation do not reuse a prior pass's observations.

```sh
cargo test --locked --test cli local_links::
```

## Private docs during cleanup

Rust cleanup copies ignored regular `docs/` files into the main checkout without overwriting or staging them.
Non-ignored untracked docs still block cleanup under the unchanged safety checks.
The retained Python implementation intentionally keeps its historical cleanup behavior.
`rust_support.current_rust_help` projects the Rust-only cleanup description and `leave` command-list additions when comparing reference help and diagnostics.
All other bytes and exit statuses remain exact comparisons.
Rust process cases in `tests/cases/preserve_docs.rs` and `preserve_docs_edges.rs` verify the new behavior independently of that reference.
They cover read-only checks, ignored-doc copying, untracked-doc refusal, identical and conflicting destinations, binary and unusual file names, unsafe paths, changed integration evidence, and copy failures.
A tracked CR-name and ignored LF-name collision checks that Git filename enumeration preserves exact bytes.
The native Pi and bounded Claude fixtures verify return-before-copy and the unchanged dirty-worktree checks.
Concurrent writers and bind-mounted aliases are outside this copy step's supported conditions; stop other work before cleanup.

```sh
cargo test --locked --test cli preserve_docs
```

## Bash completion

`tests/cases/completions.rs` runs the Rust-produced setup in clean Bash processes with disposable homes.
Cases cover both installed names, executable paths with spaces, current-project task names, typed-flag positions without flag suggestions, `--`, literal shell metacharacters, quiet failures, and managed names beyond the list display limit.
A held WT operation lock, file-content/modification-time snapshots, and Git process traces check that completion does not lock, mutate, fetch, or invoke cleanup.
The retained Python oracle gains only the help note identifying the Rust-only setup commands; its lifecycle assertions remain unchanged.
The component lint gate syntax-checks and ShellChecks the embedded Bash source.

```sh
cargo test --locked --test cli completions::
```

## Bash directory switching

`tests/cases/shell.rs` and its `shell_leave.rs` cases source the Rust-produced shell integration in disposable Bash processes with both command names on a controlled PATH.
Cases verify that plain entry changes the same shell's directory, while JSON output, help, invalid input, missing tasks, and Git-locked tasks do not.
`leave` returns from task subdirectories, preserves unfinished work and task branches, and is harmless at primary.
Submodule cases verify the destination is the submodule's working checkout.
Fresh-repository cases verify that `leave` needs no administrative write access, creates no lock file, and does not contend with mutation locking.
Other commands still respect the WT operation lock.
They preserve executable output and exit status, exercise `command` bypass, and prove that `new` does not automatically enter.
Paths with spaces, quotes, shell syntax, and newlines stay literal, including with a custom `cd` function, `CDPATH`, strict shell options, and repeated setup.
A primary path ending in newlines returns to that exact directory, even when its newline-free prefix is another existing directory.
A README quickstart case executes the documented commands and checks task entry and exact return from a newline-ending primary path.
Git destination discovery also preserves carriage returns.
Submodule cases retain trailing newlines, spaces, tabs, and CR/LF when the whitespace-free prefix is another valid checkout.
Completion still works through the wrapped names.
Setup validation runs outside Git without installing resources or editing startup files.
The component lint gate syntax-checks and ShellChecks both embedded Bash sources.
The disposable installer fixture also sources the installed fragment and checks both entry and return through each command name.
These tests do not enable integration in the live user shell or prove other-shell compatibility.

```sh
cargo test --locked --test cli shell::
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
