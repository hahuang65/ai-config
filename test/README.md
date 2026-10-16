# Replacement package tests

Run `make test` from the package checkout.
Tests use disposable homes and fake providers; they must not install into the live home, import old Work log history, contact a real provider, or read saved credentials.

- `package-*.test.ts` verifies the retained skills, specialist roles, ordinary Claude and Pi discovery, guard adapters, shared commands, status displays, themes, LSP plugin separation, and review boundaries.
- `package-instruction-routing.test.ts` follows consolidated instructions through disposable manifest-declared skill and bootstrap links for both harnesses.
  It checks that both bootstraps receive the ordinary-work continuation policy, code/work-log checkpoints route back to that same policy, and existing approval and completion boundaries remain explicit.
  It also checks that finding-decision safeguards and documentation conventions remain reachable from their source-owned references, and that the package overview points to the full native transition contract.
  `package-commands.test.ts` checks that a needed provider review asks only for missing scope-specific authorization while delivery still cannot start a provider review.
  These are routing and content checks, not proof that a model will obey the instructions.
- `reviewer-runtime.test.ts` checks the restricted Pi reviewer with a synthetic provider and a private source snapshot.
  Its process entry is the test-only Cargo example `reviewer-fixture`, backed by the shared runner library, not a production or installed command.
  `make build-evaluation-debug` builds this driver for package/Rust tests; `make build` does not build or install it.
  The native Claude reviewer suite uses the same driver and skips only for missing host capabilities, never because a build artifact is absent.
- `guards.test.ts` checks shared guard behavior.
- `cli-links.test.ts` checks executable link ownership in disposable homes.
  The retired WT Python install/repeat/uninstall test was replaced by `package-install-entrypoints.test.ts`, which exercises foreign regular files and dangling links through the real shell installer and rejects the removed uninstall interface without side effects.
  Shell installation/repeat tests and the WT CLI suites retain successful installation, repeat ownership, and executable behavior coverage.
- `package-install-*.test.ts` exercises the shell installer with disposable homes and source copies, fake build/tool executables, and real jq/coreutils processes.
  It covers missing dependencies, source/HOME separation, exact numeric preservation, ownership refusals, recorded alias upgrades, live lock contention, rollback, concurrent-edit refusal, and private record permissions.
  Transaction failure tests inject a failing rename; the lock test waits for a real process barrier, not an elapsed-time guess.
  GNU coreutils are required; the macOS system find is also exercised.
  Applicable Rust installation-library scenarios have moved to these suites; unrecorded-adoption cases and private implementation tests are deliberately retired, not counted as retained coverage.
  See the [coverage migration](installer-migration.md) for the behavior-to-suite mapping.
  Former `ai-config` and generic `evaluation` installation consumers now invoke the real shell installer through a disposable-package helper; both native harness discovery checks use the same shell fixture, without skipping when an obsolete binary is absent.
- `package-tool-inventory.test.ts` checks catalogue coverage for manifest CLI aliases, the current Rust executable source layout, literal Pi tool registrations, and bare Claude tool denials.
  It does not contact MCP servers or assert that a documented host tool is active in every session.
- `resolve-conflicts.test.ts` checks the rebase-only skill contract.
- Every `tools/evaluation/tests/*.rs` integration suite runs, including package validation, configuration ownership, frozen evidence, restricted reviewers, consultations, and human-confirmed comment-only publication with disposable fixtures and fake providers; no hand-maintained suite allowlist can omit new safety tests.
- `package-review-gate.test.ts` checks the complete and focused gates, shared executable build prerequisites, bounded WT worker selection, and grouped evaluation case wiring.
- Rust tests and `tools/worktree/tests/rust_parity.py` check the standalone worktree CLI, including the process-level ownership, cleanup, interruption, and submodule cases; Rust tests also check Worklog.
- The original Python worktree CLI's reference-only tests are not part of the replacement gate; the parity runner executes their applicable cases against the Rust CLI.
- `tools/artifact-review/tests/` checks local review storage, revision-bound per-finding repair decisions through the Rust CLI, and the bounded Firefox integration after an explicit offline debug CLI build.
  Its real change-report case covers Accept/Reject, annotations, retry after response loss and reload, and preservation of the retained HTML; ordinary artifact approval keeps its existing coverage.
  `tests/wait.rs` covers indefinite foreground waiting, transport heartbeats, terminal state, replay/retry, interruption/shutdown, and fresh revision checks despite render reuse.
  The bounded browser suite counts idle event/snapshot requests and verifies live feedback, replies, and document reload through revision-only checks.

The native Pi and Claude task-conversation runtime checks remain in the package suite.
The Pi `lsp` client uses the same eight-server catalogue as the generated Claude plugin.
`package-claude-lsp.test.ts` checks catalogue parity, fixed mise declarations, and generated projections; native Claude discovery checks all eight registrations.
`package-pi-lsp.test.ts` checks source-to-bundle parity separately, then loads the manifest-declared bundle through the actual Node/Pi loader in disposable homes with fake stdio servers.
It covers lazy startup, reuse, queries, disk updates, capability-dependent pull diagnostics, push diagnostics, stale reports after eviction/reopening, capability errors, bounded documents/output, path guards, server-directed edit refusal, and shutdown.
`package-pi-lsp-transport.test.ts` covers fragmented frames, malformed envelopes, oversized responses, queued-output overflow from a non-reading server, missing executables, exit, timeout, cancellation, and descendant termination (including inherited pipes) with real pipes and no providers.
These tests never provision or launch the real language servers; see [shared contracts and limits](../docs/language-servers.md).

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
Each browser caller passes its Node test context before acquisition, so a case timeout cancels startup and pending WebDriver commands, stops the process group, and permanently forbids suite reuse.
Cancellation reports only the last startup stage or protocol method, not URLs, expressions, response bodies, or abort reasons; command timeouts name the method.
A completed case detaches its cancellation listener before another case starts.
Deterministic lifecycle checks cover serial use, idempotent close, cancellation during discovery/connection/context creation, shutdown during startup, setup failure, and failed or incomplete cleanup.
A bounded child Node runner deliberately times out one fake-browser case and verifies cancellation diagnostics and absence of serial-overlap failures; transport checks advance a fake clock rather than waiting for real deadlines.
This isolates the tested page/storage state, not every browser-wide setting or failure: cases must not mutate browser preferences, and a browser crash fails the remaining browser cases.

Evaluation's change-review cases live in `tools/evaluation/tests/cases/change_*.rs`, included by the single `tests/change.rs` integration target.
Rust schedules those independent cases together rather than Cargo running nine binaries sequentially; their assertions and deadlines are unchanged.
Only support code is shared: every case still creates its own disposable home, repository, provider state, and review store.
Run the group with `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test change`.
Add a module-name filter such as `change_post_safety::` to focus it, or append `-- --test-threads=1` for serial debugging.
The reviewer and consult cases similarly share `tests/runners.rs` rather than four separate integration binaries.
Their case modules are `cases/{consult,reviewer,reviewer_claude,reviewer_diagnostics}.rs`; the fake reviewer script lives in `support/reviewer.rs`.
All cases retain their assertions, deadlines, and separate disposable homes, repositories, provider state, and output files.
First run `make build-evaluation-debug` to build the test-only reviewer driver, then run `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test runners`, optionally filtering a module such as `reviewer_diagnostics::` or appending `-- --test-threads=1`.
Shell-backed package and installation cases share `tests/configuration.rs` and the existing Rust test-thread limit.
They live in `cases/configuration_package*.rs` and `cases/package_*.rs`; no Rust installation library remains.
The package-manifest helper runs `install.sh` in a disposable home and reads its completed ownership record rather than duplicating validation or effects.
Every case retains its separate disposable installation source, home, ownership record, lock, and output files; shared package inputs remain read-only.
Run the group with `cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --test configuration`, optionally filtering a module such as `configuration_package_resources::` or appending `-- --test-threads=1`.
The complete evaluation gate still discovers integration targets automatically, including future targets outside these groups.
The retired Rust file-lock/fork regression does not apply to the replacement lock-directory protocol, which has its own shell-process contention and release checks.

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
