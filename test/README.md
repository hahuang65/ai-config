# Replacement package tests

Run `make test` from the package checkout.
Tests use disposable homes and fake providers; they must not install into the live home, import old Work log history, contact a real provider, or read saved credentials.

- `package-*.test.ts` verifies the retained skills, specialist roles, ordinary Claude and Pi discovery, guard adapters, shared commands, status displays, themes, LSP plugin separation, and review boundaries.
- `reviewer-runtime.test.ts` checks the restricted Pi reviewer with a synthetic provider and a private source snapshot.
- `guards.test.ts` checks shared guard behavior.
- `cli-links.test.ts` checks executable link ownership in disposable homes.
- `resolve-conflicts.test.ts` checks the rebase-only skill contract.
- Every `tools/evaluation/tests/*.rs` integration suite runs, including package validation, configuration ownership, frozen evidence, restricted reviewers, consultations, and human-confirmed comment-only publication with disposable fixtures and fake providers; no hand-maintained suite allowlist can omit new safety tests.
- `package-review-gate.test.ts` checks the complete and focused gates, shared executable build prerequisites, bounded WT worker selection, and grouped evaluation case wiring.
- Rust tests and `tools/worktree/tests/rust_parity.py` check the standalone worktree CLI, including the process-level ownership, cleanup, interruption, and submodule cases; Rust tests also check Worklog.
- The original Python worktree CLI's reference-only tests are not part of the replacement gate; the parity runner executes their applicable cases against the Rust CLI.
- `tools/artifact-review/tests/` checks local review storage and the bounded Firefox integration after an explicit offline debug CLI build.

The native Pi and Claude task-conversation runtime checks remain in the package suite.
The package does not install a Pi language-server client.

## Focused checks

Use the smallest relevant target during development, then run `make lint` and `make test` for the complete gate.
The pre-commit hook remains a complete gate; focused runs do not authorize skipping it.
No successful-test cache or changed-file filter is used.

| Target | Checks |
| --- | --- |
| `make test-package` | Bun package, harness, guard, restricted-reviewer, and skill checks |
| `make test-worktree` | Rust WT tests and every selected process-level parity case |
| `make test-worklog` | Rust Worklog tests |
| `make test-artifact` | Rust artifact-review tests |
| `make test-evaluation` | Every Rust evaluation integration suite and library tests |
| `make test-browser` | Bounded Firefox integration, with the guard bundle and both evaluation/artifact-review debug CLIs built first |

Each target builds its own required executables; package and evaluation checks need all manifest release targets.
Multiple targets in one Make invocation share build prerequisites, for example `make test-package test-evaluation`.
A new invocation always reruns the selected tests; Cargo still manages its ordinary build cache.
The full gate includes each suite once and keeps suite invocations serial even when Make receives `-j`.
The package target excludes `test/package-worktree.test.ts` and `test/package-claude-worktree-runtime.test.ts` from its ordinary serial Bun run, then runs each file in its own invocation with `--concurrent --max-concurrency=2`.
The Pi and Claude groups run sequentially, never concurrently with one another or the ordinary package tests, and every test file runs exactly once.
The three complete Pi runtime scenarios keep separate Node processes, temporary homes, repositories, and worktrees; the file's two read-only package checks run in the same bounded group.
The two native Claude scenarios keep separate sandboxed processes, homes, repositories, session histories, and loopback fake API servers.
Their assertions, watchdogs, platform skips, and independent harness configuration are unchanged.
All other package tests, including the Claude hook-adapter checks, remain serial; browser integration remains serial too.
For serial diagnosis, use `bun test test/package-worktree.test.ts` or `bun test test/package-claude-worktree-runtime.test.ts` after building this checkout.
Browser-based cases share one lazily started Firefox process and temporary profile for the suite, with at most one case active.
Each case gets a disposable WebDriver user context (an isolated browser storage container) and one fresh blank tab with its viewport reset.
The default startup tab stays blank and keeps the browser alive between cases; tests cannot use it.
Closing a case removes its entire user context and verifies its tabs and storage container are gone before allowing another case.
Startup, setup, or cleanup failure stops the shared browser and forbids reuse, without automatic retry or fallback.
Suite teardown stops the process group and removes its temporary profile; writable application fixtures remain independent per case.
Real-browser regressions check same-origin cookies, local/session storage, IndexedDB, cache storage, viewport reset, extra-tab removal, and termination of a live worker request.
Deterministic lifecycle checks cover serial use, idempotent close, shutdown during startup, setup failure, and failed or incomplete cleanup.
This isolates the tested page/storage state, not every browser-wide setting or failure: cases must not mutate browser preferences, and a browser crash fails the remaining browser cases.

Evaluation's change-review cases live in `tools/evaluation/tests/cases/change_*.rs`, included by the single `tests/change.rs` integration target.
Rust schedules those independent cases together rather than Cargo running nine binaries sequentially; their assertions and deadlines are unchanged.
Only support code is shared: every case still creates its own disposable home, repository, provider state, and review store.
Run the group with `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test change`.
Add a module-name filter such as `change_post_safety::` to focus it, or append `-- --test-threads=1` for serial debugging.
The reviewer and consult cases similarly share `tests/runners.rs` rather than four separate integration binaries.
Their case modules are `cases/{consult,reviewer,reviewer_claude,reviewer_diagnostics}.rs`; the fake reviewer script lives in `support/reviewer.rs`.
All 35 cases retain their assertions, deadlines, and separate disposable homes, repositories, provider state, and output files.
Run them with `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test runners`, optionally filtering a module such as `reviewer_diagnostics::` or appending `-- --test-threads=1`.
Installer and configuration cases share `tests/configuration.rs` rather than 17 separate integration binaries, retaining all 120 cases and the existing Rust test-thread limit.
They live in `cases/configuration_*.rs` and `cases/package_*.rs`; resource-validation cases were split out as `configuration_package_resources.rs` to keep the files small without changing test bodies.
Every case retains its separate disposable installation source, home, ownership record, lock, and output files; shared package inputs remain read-only.
Run the group with `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test configuration`, optionally filtering a module such as `configuration_inventory_safety::` or appending `-- --test-threads=1`.
The complete evaluation gate still discovers integration targets automatically, including future targets outside these groups.

WT parity runs independent cases in at most four spawned worker processes, preserving their disposable fixtures and grouping output by case.
It discovers the same cases as serial execution, retains skips and all failure outcomes, and fails if a worker crashes.
The worker pool is reused within one invocation, so cases must not depend on interpreter-global or class-fixture state surviving from another case.
Use `make test-worktree WT_TEST_JOBS=1` for the original serial runner, or select 2–4 workers.
Runner self-tests execute separately before parity, so their synthetic worker pools do not nest inside the real case workers.
They exercise concurrency bounds, assertion/error/subtest failures, expected failures, unexpected successes, skips, crashes, and serial fallback.
Run those alone with `python -m unittest discover -s tools/worktree/tests -p parallel_runner_tests.py -v`.
The Python-driven fixtures reuse two pristine Git snapshots per serial process or spawned worker, bounded to 128 entries and 256 KiB of file contents per snapshot.
Each case receives independently writable files, modes, config, refs, objects, and working files; no hardlinks, persistent cache, or test outcomes are shared.
Seed creation alone disables automatic maintenance, and failed or unsafe captures are never cached.
Five fixture regressions join the original 83 parity cases in the same bounded pool, without nested worker pools; runner self-tests verify their registration.
See [WT fixture details](../tools/worktree/docs/testing.md#python-driven-repository-fixtures) for bounds, failure checks, and focused invocation.

Worklog's store-level lock test uses a 10ms deadline against a real file lock; the production CLI keeps its three-second deadline without a test-only environment override.
The unchanged 20ms lock polling interval can extend that test's wait beyond its configured deadline.
A separate storage test waits for two real lock conflicts before unlocking, proving retry and recovery without inferring readiness from elapsed time.
Its private contention observer is a no-op in production; the writer retains the production deadline.
CLI integration checks successful output and retained history after external lock release, not whether the child had already reached contention.
It no longer exhausts the production deadline to test its error exit end to end.
Worklog fixtures share only an in-memory snapshot of an empty repository, initialized once per test process without personal Git templates.
Every case writes independent repository files and uses its own store; the snapshot disappears with the test process and never caches test results.
The pagination fixture derives history from one real CLI note, then writes additional records directly instead of repeating write-path checks.
Fixture regressions verify distinct tasks and a subsequent real CLI append; dedicated write-safety tests remain unchanged.

The [test-duration tuning checklist](timings.md) lists every adjusted timeout, delayed write, and observation window by named constant, including timing relationships and verification requirements.
