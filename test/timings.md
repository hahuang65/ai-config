# Test-duration tuning checklist

These are the lock, subprocess, and browser-fixture durations adjusted during the test-gate speed work.
Edit the named constants in the linked files; shell fixture delays are derived from those constants too.
The values below are the current settings, not promises that lower values will be reliable.
Update this list whenever a setting changes.
Checked rows mean the documented setting was audited against source and retained through the full gate, not that further reductions are safe.

## Bounded ordinary package workers (#397)

At `731e444`, the ordinary Bun stage remained serial and took 155.66s in the latest successful commit hook.
A parallel/serial/parallel comparison used the same 276 cases and file groups, unchanged assertions and deadlines, disposable homes, and the same scratch-root layout:

| Scheduling | Elapsed time | Cases |
| --- | --- | --- |
| Two Bun workers, first trial | 58.23s | 276 passed |
| One Bun worker at a time | 138.68s | 276 passed |
| Two Bun workers, second trial | 57.26s | 276 passed |

Claude hook lifecycle, Claude/Pi discovery, reviewer runtime, and Pi LSP transport formed one group of 38 cases across five files.
The remaining 238 cases across 26 files formed the other group.
These are warm local observations, not controlled host-load or cross-platform guarantees.

`test/packages.mk` now discovers ordinary files, excludes installer and native-runtime files, and schedules two isolated Bun processes.
`PACKAGE_TEST_JOBS=1` runs the same groups serially; other values fail before commands run.
The main Makefile still waits between the ordinary, installer, Pi, and Claude stages; browsers remain serial and separate.
No assertion, production timeout, installer worker cap, installed configuration, or successful-test cache changes.
Worker fixtures share only test support code through `fixtures/bun-workers.ts`; every fake-worker scenario keeps its own temporary state and unchanged guards.
Real barriers prove overlap and serial ordering, and negative controls catch accidental serialization or hidden pipeline failures.
Gate inventories cover default, individual/both serial overrides, and `make -j4`, while nested checks exercise inherited Make overrides.

The updated serial ordinary stage passed all 285 cases in 111.52s with an enclosing `PACKAGE_TEST_JOBS=1` setting.
The full default `make lint test` passed in 653.21s (10m 53.21s); its ordinary workers passed 38/247 cases in 58.41/56.94s.
All 83 installer cases, both native groups, the Rust suites, and all 64 browser cases passed, with the same two filesystem-dependent parity skips.
The ordinary stage therefore improved in these runs, but the full run was not faster than the earlier 640.04s gate.
The browser stage took 112.50s versus 66.60s in that earlier gate, other stages also varied, and host load was high after the run.
Do not interpret this result as a demonstrated gate-wide speedup.

## Bounded installer workers (#384)

At `2523925`, the installer files remained the largest serial bucket: 83 cases took 652.38s in the latest commit-hook run.
A local comparison ran the same two file groups concurrently and then serially, without changing the installer or its tests.
Rollback, records, paths, and performance formed one group of 24 cases; the other ten installer files formed a group of 59 cases.
All 83 cases passed in both successful trials:

| Scheduling | Elapsed time | Cases |
| --- | --- | --- |
| One Bun worker at a time | 656.51s | 83 passed |
| Two Bun workers | 231.67s | 83 passed |

This is one warm local comparison, not a repeated benchmark or a cross-platform guarantee.
Both trials used disposable source copies, fake provisioning/builds, real filesystem commands, and the same short private scratch-root layout.
The first attempted trial used a longer nested scratch prefix and hit macOS's pathname limit while constructing the existing 129-level fixture.
No test or depth assertion was changed; the successful comparison used short trial roots, and the regular gate retains its normal temporary-directory layout.

The package gate now runs the two installer groups in a separate sub-make capped at two Bun workers.
`INSTALL_TEST_JOBS=1` runs the same groups serially; other values fail before build or test commands.
The main Makefile stays serial around that sub-make, so ordinary package tests, native Pi/Claude runtime groups, and browser integration do not overlap with it.
Per-case and per-installer watchdogs, all transaction assertions, and production installer behavior are unchanged.
A barrier regression fails if the sub-make is accidentally serialized, and failure regressions fail if output prefixing hides either worker's exit status.
Their disposable negative controls were observed to fail as intended.

The first two-worker `make lint test` gate passed in 655.30s (10m 55.30s), compared with the prior 1,080.81s (18m 00.81s) gate.
That is an observed reduction of 425.51s, about 39%; separate full-gate runs do not isolate host-load effects.
With the normal temporary-directory layout, the installer workers passed 24/59 cases in 225.72/231.49s.
The ordinary Bun group passed 274 cases in 140.06s, including the eight new worker/gate regressions.
The native Pi/Claude groups passed 5/2 cases, the Rust review/configuration/runner groups passed 70/43/36, and all 64 browser cases passed.
The same two filesystem-dependent parity skips remained.

Review then identified an inherited-environment problem in the new default-worker preview assertion.
An enclosing `INSTALL_TEST_JOBS=1` setting made that assertion expect two workers from a one-worker preview.
The selected repair isolates Make override variables in that test and adds a nested enclosing-serial-environment regression, observed RED then GREEN.
After this test-only repair, the complete `make lint test INSTALL_TEST_JOBS=1` gate passed in 903.75s (15m 03.75s).
It passed 275 ordinary Bun cases, the same 24/59 installer cases scheduled serially, both native runtime groups, all Rust suites, and all 64 browser cases, with the same two parity skips.
The first two-worker timing above preceded this test-only repair; worker scheduling and production installer behavior did not change.
A fresh default `make lint test` after the repair passed in 640.04s (10m 40.04s).
It passed 275 ordinary Bun cases, including nine new worker/gate regressions, and the installer groups passed 24/59 cases in 232.37/237.85s.
All other group counts and the two parity skips remained unchanged.
The latest default gate was 440.77s shorter than the preceding 1,080.81s gate; the same separate-run timing caveat applies.

The synthetic installer and ordinary worker checks share these unchanged finite guards in [fixtures/bun-workers.ts](fixtures/bun-workers.ts):

| Constant | Value | Purpose |
| --- | --- | --- |
| `WORKER_BARRIER_SECONDS` | 3s | Bound waiting for the other fake Bun worker to start |
| `MAKE_GUARD_MS` | 10s | Bound the test-only Make subprocess |
| `CASE_GUARD_MS` | 15s | Cover fixture setup, the command guard, and cleanup |

## Installer test-layering follow-up (#379)

The audit in #377 counted 120 installer launches across 85 Bun installer cases and 101 across the 42-case Rust configuration suite, including help and rejection paths.
This follow-up combines the three positive process-overhead checks into one instrumented installation, retaining the six independent metadata-refusal cases.
Restoring repeated parent creation, individual support metadata processes, or plain-file tree walking separately in disposable installer copies makes the combined check fail for its intended assertion.

Rust data-only catalogue assertions now exercise the production `native_package` filter directly, with a 10s watchdog.
Filesystem safety cases, actual release-build validation, installation/repeat behavior, source switching, rollback, and lock contention remain end-to-end.
Three scenarios inspect their own completed installation instead of performing an extra installation for expected data.
Change-review and runner-diagnostic fixtures no longer install unrelated resources; their new no-installation assertions were observed RED before the setup changes and GREEN afterward.
The catalogue boundary likewise passed with a deliberately refusing installer only after it stopped invoking installation.
No installed-home snapshots or successful-test results are cached.

Single local before/after runs on the same host measured these test-body durations, excluding Cargo compilation:

| Focused check | Before | After | Cases after |
| --- | --- | --- | --- |
| Installer performance and safety | 51.17s | 29.22s | 7, down from 9 through consolidation |
| Rust configuration | 77.73s | 43.23s | 43, including one new boundary regression |
| Restricted-runner and consultation group | 45.61s | 8.22s | 36, unchanged |
| One report-rendering case | 13.14s | 1.31s | 1, with added no-installation assertions |

The full 70-case change-review group passed in 36.62s after removing unrelated installation setup.
The runner group also passed two further checks in 7.97s and 7.94s.
These are warm local observations, not repeated controlled before/after benchmarks or cross-platform guarantees.

The first full gate exposed a diagnostic-fixture deadline mismatch: a stdout-limit probe reached its one-second deadline before the fake provider emitted any bytes.
Only the actual timeout probe now uses `--timeout 1`; stdout/stderr-limit probes use an explicit 10s startup margin and still assert the exact output-limit diagnostics and private-output withholding.
The margin is a finite watchdog, not a successful-path wait or a change to production defaults.
The temporary 60s Bun installer-command guard, composed scenario budgets, transaction assertions, durability operations, and concurrency limits remain unchanged.
The Rust full-installer helper still lacks an equivalent per-command deadline; the new 10s watchdog bounds only direct catalogue-filter checks.

The final `make lint test` gate passed in 1,080.81s (18m 00.81s), versus the preceding successful gate's 1,335.67s (22m 15.67s).
The observed difference is 254.86s, about 19%; these separate full-gate runs do not isolate host-load effects.
The final serial Bun group passed 349 cases in 800.45s, down from 351 after consolidating two duplicate positive-installation setups.
The Rust change-review, configuration, and runner groups passed 70/43/36 cases in 36.44/42.58/8.20s, and all 64 browser cases passed.
The same two filesystem-dependent WT parity cases remained skipped.
Source-level counts now give 118 installer launches across 83 Bun installer cases and 70 across the 43-case Rust configuration suite, including help and rejection paths.

## Installer process-overhead checkpoint (#365)

This pass compares the installer at `9583d45` with the optimized working tree on macOS arm64 using Bun 1.3.14, real jq/coreutils, and disposable installation homes.
Three alternating baseline/optimized pairs used the same fixture setup, including an obsolete link, a removed settings claim, and an injected source-switch rename failure.
Provisioning, builds, and packaged tool executables were stubbed, as in the normal installer tests; no live home was installed into.
Fixture copying took about 10ms and was not the main cost.
The table reports median command times, excluding fixture creation and cleanup:

| Command | Baseline | Optimized | Reduction |
| --- | --- | --- | --- |
| Initial installation | 13.606s | 11.358s | 16.5% |
| Repeat installation | 6.727s | 5.516s | 18.0% |
| Source switch with injected failure and rollback | 30.276s | 24.837s | 18.0% |

The changes avoid `mkdir -p` when a destination parent already exists, inspect plain file resources without launching tree walkers, and read support-file metadata in one GNU `stat` invocation.
Parent-path checks remain in place, and real resource directories still use the existing bounded traversal.
The metadata batch checks every file's regular-file mode, hard-link count, and byte limit, and refuses failed, incomplete, malformed, or excess output before changing HOME.
Metadata is not cached between installations; generated tool hard-link exceptions stay separate.
A fixture that swaps a support file for a symlink at the metadata boundary is rejected.
The entry-count regression now injects excess entries into an actual resource directory, retaining its count/depth and unchanged-home assertions.

A trace of the same fixture counted these subprocess calls:

| Calls | Initial: before → after | Repeat: before → after | Rollback: before → after |
| --- | --- | --- | --- |
| `stat` | 196 → 114 | 136 → 54 | 283 → 201 |
| `mkdir` | 74 → 16 | 2 → 2 | 140 → 2 |
| `find` and `head` combined | 84 → 40 | 84 → 40 | 82 → 40 |

Nine performance/safety regressions cover the reduced process counts and metadata refusal paths.
A negative control removed only the hard-link check in a disposable installer copy; installation then succeeded with a hard-linked support file, demonstrating that the refusal regression would fail.
The 60s command guard, composed scenario budgets, rollback assertions, transaction locks, durability operations, and concurrency limits are unchanged.
These three warm local pairs do not justify tightening the guard for slower hosts or higher load.

The full `make lint test` gate passed in 1,335.67s (22m 15.67s), including the nine new cases and the existing two filesystem-dependent parity skips.
Its serial Bun package group passed 351 tests in 812.90s, compared with 342 tests in 970.19s in the preceding successful gate.
Those full-gate runs were not paired under controlled host load, so they are observations rather than a causal end-to-end speedup claim.
The paired installer measurements above provide the direct comparison.

## Test-gate speed checkpoint (#121)

That task's final macOS check passed `make lint` and the complete `make test` gate with Rust 1.99.0, Python 3.11.4, and Bun 1.3.14.
The warm full gate took 146.3 seconds, versus the earlier successful 348.9-second warm serial baseline: about 58% less elapsed time.
It reported 539 cases: 537 passed and the same two filesystem-dependent filename cases skipped.
These are local warm-run measurements, not cold-build or cross-platform performance guarantees.
All adjusted settings below match their source constants; production deadlines are unchanged, and this audit makes no further timing reductions.
The 150ms interrupt-start hold is intentionally retained because shortening it still needs an observable readiness proof.

## Artifact-review waiting checkpoint (#105)

A local macOS debug-build fixture with 2,500 repeated HTML sections and no images measured seven event requests per one-second idle CLI poll before the change, and one held request afterward (three samples each).
Twenty warm revision-only requests took 1,106 ms while rebuilding snapshots and 127 ms with one-entry render reuse.
These are bounded local fixture measurements, not release-build, cold-cache, or cross-platform guarantees.
The browser regression independently verifies that an open idle review holds its event request and does not repeatedly download unchanged snapshots.
Every current revision and approval still hashes current HTML and displayed image bytes, including same-size/same-mtime image replacements.

## Worklog

| Check | Constant | Current value | Source |
| --- | --- | --- | --- |
| [x] Store lock deadline | `LOCK_DEADLINE` | 10ms | [store_locking.rs](../tools/worklog/tests/cases/store_locking.rs) |

The lock deadline uses the real operating-system lock and the production 20ms polling interval, so reducing it further may not reduce elapsed time.
The former 100ms `LOCK_RECOVERY_HOLD` is retired: CLI startup timing did not prove contention.
The storage recovery test now waits for two notifications from real failed lock acquisitions before releasing the held lock.
This proves retry while contended, then successful append with retained history; its writer uses the unchanged production lock deadline.
The private observer is a no-op for production callers, with no environment override or public test switch.
The CLI test retains output/history checks after external lock release but does not claim to prove contention.
Both ignoring lock failure and refusing to retry must make the storage recovery test fail.

### Commit-skill fixture watchdog (#391)

The synthetic Worklog commit scenario runs 25 real subprocesses: Git initialization, 21 task starts, two list calls, and one commit-recording call.
Two commit hooks exceeded Bun's default 5s whole-case deadline, although each subprocess already had a 10s limit.
A disposable control added 250ms of startup delay before each unchanged subprocess call and reproduced the 5s failure.
With the repaired scenario budget, all 25 calls and the original assertions passed in 9.79s; the normal focused case took 2.28s.
The startup delay exists only in that disposable control, not in the committed fixture.

The constants in [fixtures/commit-log.ts](fixtures/commit-log.ts) compose the whole-case budget:

| Constant | Value | Purpose |
| --- | --- | --- |
| `COMMIT_LOG_COMMAND_GUARD_MS` | 10s, unchanged | Bound each real Git or Worklog subprocess |
| `COMMIT_LOG_COMMAND_COUNT` | 25 | Twenty earlier tasks plus the five remaining CLI calls |
| `COMMIT_LOG_SCENARIO_GUARD_MS` | 260s | Sum 25 command limits and one command-sized setup/cleanup margin |

The scenario counts actual invocations and asserts that they match the budget.
A fast regression pins the 20 earlier tasks, 25 calls, unchanged command limit, and cleanup margin.
The 260s watchdog is an upper bound, not a successful-path wait; a stalled subprocess still reaches its individual 10s limit.
All default-list omission, complete-list lookup, commit hash, explicit commit-authority, and A5/parent-repository assertions remain in place.
Only disposable Worklog state is used, and no production deadline or installed configuration changes.

## Shell installer fixtures

| Check | Constant | Current value | Source and purpose |
| --- | --- | --- | --- |
| Temporarily adjusted | `INSTALL_COMMAND_GUARD_MS` | 60s | [install-script.ts](fixtures/install-script.ts): subprocess limit for one installer transaction |
| Derived | `installerScenarioGuard(transactions)` | `(transactions + 1) × 60s` | [install-script.ts](fixtures/install-script.ts): sum sequential invocation limits plus one setup/cleanup margin |
| Derived | `SOURCE_SWITCH_GUARD_MS` | 360s | [package-install-switch.test.ts](package-install-switch.test.ts): five sequential installer limits plus one 60s fixture setup/cleanup margin |

The invocation limit is temporarily one minute because two rollback fixtures were terminated by the former 30s command guard before they could report their restoration results.
A disposable reproduction returned `ETIMEDOUT` and `SIGTERM` after 30s; it did not establish the natural completion time.
The installer process-overhead checkpoint above records the follow-up profiling; the one-minute limit remains in place.
This adjustment preserves finite watchdogs and all rollback assertions; it changes no production installer deadline.

The source-switch scenario covers initial installation, repeat installation, switching sources, switching back, and recovery after removing the former source.
Its previous 40s whole-case watchdog was shorter than the combined subprocess budgets and left no headroom on a measured local run of about 40s for five successful transactions.
Scenario watchdogs derive from the per-command test limit; they do not add successful-path waits or change installer behavior or assertions.

The ownership-record preservation scenario had the same mismatch: five installer invocations shared one 30s whole-test deadline.
A disposable diagnostic run completed the initial installation and all four expected rejections in 28.1s, leaving little scheduling margin.
With a composed scenario deadline, the unchanged assertions passed in 35.7s; the former deadline would have killed correct work.
These are local observations, not performance guarantees or evidence of a per-installer hang.

The record, transaction, rollback, and modified-link-switch scenarios now use `installerScenarioGuard` with their actual sequential invocation counts:

| Suite | Invocations per scenario, in source order | Whole-scenario budgets |
| --- | --- | --- |
| [Ownership records](package-install-records.test.ts) | 2, 5, 5, 3, 2 | 180s, 360s, 360s, 240s, 180s |
| [Transactions](package-install-transaction.test.ts) | 2, 2, 3, 3 | 180s, 180s, 240s, 240s |
| [Rollback](package-install-rollback.test.ts) | 2 for each source-switch failure, 2 for a concurrent edit, 1 for first-install failure | 180s, 180s, 120s |
| [Modified obsolete link](package-install-switch.test.ts) | 3 | 240s |

`package-install-budgets.test.ts` pins the temporary 60s invocation limit and checks the composed budgets and setup/cleanup margin.
Adding another installer invocation requires updating its scenario count.
These watchdogs remain upper bounds, not waits, and do not relax transaction assertions or production behavior.

## Claude hook scenario

`CLAUDE_HOOK_SCENARIO_GUARD_MS` in [package-claude-worktree.test.ts](package-claude-worktree.test.ts) is 120s.
The whole-case watchdog covers repository setup, new-task entry, saved/manual conversation checks, leave/re-entry, damaged-reference checks and cleanup.
The former 30s deadline repeatedly interrupted correct intermediate checks in full package runs.
A focused passing run took 29.9s, leaving almost no scheduling margin under that former deadline.
The package's WT client already permits 120s for one CLI invocation; its timeout and the 10s Git-command limits remain unchanged.
The larger test-only watchdog does not add sleeps, remove assertions or change native adapter behavior.

## WT subprocesses

All six settings live in [process.rs](../tools/worktree/tests/support/process.rs).

| Check | Constant | Current value | Purpose |
| --- | --- | --- | --- |
| [x] Timeout deadline | `TIMEOUT_DEADLINE` | 100ms | Inherited-pipe and cancellation deadlines |
| [x] Cancelled descendant's write delay | `CANCELLED_WRITE_DELAY` | 200ms | Schedule a write after cancellation should occur |
| [x] Cancellation observation | `CANCELLED_WRITE_OBSERVATION` | 200ms | Detect a writer that escaped cancellation |
| [x] Exited leader's descendant write delay | `EXITED_WRITE_DELAY` | 100ms | Delayed write after successful or failed leader exit |
| [x] Leader-exit observation | `EXITED_WRITE_OBSERVATION` | 200ms | Detect a writer that escaped leader-exit cleanup |
| [x] Descendant-readiness polling | `DESCENDANT_READY_POLL` | 5ms | Leader waits for the descendant to start before exiting |

Keep these relationships, with scheduling headroom rather than equality:

- `TIMEOUT_DEADLINE < CANCELLED_WRITE_DELAY < TIMEOUT_DEADLINE + CANCELLED_WRITE_OBSERVATION`.
- `DESCENDANT_READY_POLL < EXITED_WRITE_DELAY < EXITED_WRITE_OBSERVATION`.
- The descendant-start checks must continue to pass; killing an unstarted fixture is not cancellation coverage.

The relationships are necessary budget checks, not a substitute for testing under load.
A missing marker only proves the descendant did not write during the observed interval.

## Evaluation subprocesses

The two redirected-descendant tests use [reviewer_process.rs](../tools/evaluation/tests/support/reviewer_process.rs).
Their production process-group cleanup and caller deadlines are unchanged.

| Check | Constant | Current value | Purpose |
| --- | --- | --- | --- |
| [x] Descendant write delay | `EXITED_WRITE_DELAY` | 100ms | Write after reviewer leader exit |
| [x] Leader-exit observation | `EXITED_WRITE_OBSERVATION` | 200ms | Detect a descendant that escaped cleanup |
| [x] Descendant-readiness polling | `DESCENDANT_READY_POLL` | 5ms | Confirm the descendant started before leader exit |

Keep `DESCENDANT_READY_POLL < EXITED_WRITE_DELAY < EXITED_WRITE_OBSERVATION`, with scheduling headroom.
Both cases must fail if the runner's group cleanup is deliberately disabled.

## Browser fixtures

| Check | Constant | Current value | Source and purpose |
| --- | --- | --- | --- |
| [x] Browser-state polling | `BROWSER_STATE_POLL_MS` | 20ms | [integration.mjs](../tools/artifact-review/tests/integration.mjs): poll observable DOM/server state rather than sleeping for 100ms between checks |
| [x] Process-group shutdown polling | `SHUTDOWN_POLL_MS` | 10ms | [firefox-process.mjs](../tools/artifact-review/tests/firefox-process.mjs): return as soon as the entire Firefox group is gone |
| Retained | `INTERRUPT_START_HOLD_MS` | 150ms, unchanged | [integration.mjs](../tools/artifact-review/tests/integration.mjs): allow CLI polling to start before interrupting it; shortening needs a readiness proof |

The former fixed 200ms server-restart wait now polls for the stopped server's HTTP endpoint to become unavailable.
Firefox shutdown no longer pays the entire 300ms grace period when its process group exits earlier.
It still probes the whole group, waits up to the original grace period for survivors, and then sends SIGKILL.
Deterministic harness tests cover early exit, surviving groups, permission errors, and invalid PIDs without launching extra browsers.
Browser integration remains serial, sharing one suite-owned browser process with a disposable user context per case.
Isolation checks use event-driven worker connection/disconnection signals rather than fixed observation sleeps.
Each case removes its user context before the next starts; failed cleanup stops the shared browser rather than reusing it.
Case cancellation now reaches acquisition and pending commands, records only the last stage/method, and stops the shared browser before it can be reused.
The case and operation watchdogs retain their original budgets; a passing retry is not evidence that an earlier unexplained Firefox stall is fixed.

## Safety margins: do not tune down for speed

| Source | Constant | Current value | Purpose |
| --- | --- | --- | --- |
| Worklog `store_locking.rs` | `COMPLETION_GUARD` | 1s | Generous upper bound for a short lock failure |
| Worklog `store_locking.rs` | `CONTENTION_GUARD` | 1s per notification | Bound waiting for two observed lock conflicts; return immediately when signaled |
| WT `process.rs` | `COMPLETION_GUARD` | 1s | Generous upper bound for a short subprocess timeout |
| WT `process.rs` | `PIPE_HOLD` | 2s | Keep inherited output pipes open beyond the test deadline; cancelled early |
| WT `process.rs` | `PROCESS_GUARD_SECONDS` | 2s | Bound fixture execution; normal completion returns immediately |
| WT `rust_test_repository.py` | `FIXTURE_GUARD_SECONDS` | 20s | Bound the fresh-interpreter fixture reuse check |
| WT `rust_test_repository.py` | `GIT_GUARD_SECONDS` | 10s | Bound fixture-regression Git calls, matching the existing executable fixtures |
| Evaluation `reviewer_process.rs` | `PROCESS_GUARD_SECONDS` | 2s | Bound fixture execution; normal completion returns immediately |
| Artifact `tests/support/mod.rs` | `COMMAND_GUARD` / `COMMAND_POLL` | 15s / 5ms | Bound finding-decision CLI processes and poll for observed exit |
| Artifact `tests/support/mod.rs` | `HTTP_GUARD` | 5s | Bound local finding-decision requests |
| Artifact `tests/wait.rs` | `IDLE_OBSERVATION` / `RESPONSE_GUARD` | 150ms / 5s | Observe an actually held response, then bound event delivery without waiting for the 30s heartbeat |
| Artifact `tests/support/waiter.rs` | `EXIT_GUARD` / `EXIT_POLL` | 5s / 5ms | Bound test-only foreground wait children and reap them on failure |
| Artifact `tests/support/event_peer.rs` | `PEER_GUARD` / `ACCEPT_POLL` | 5s / 5ms | Observe heartbeat renewal using a synthetic local peer without sleeping through production heartbeat periods |
| Browser `finding-decisions.mjs` | `STATE_GUARD_MS` / `STATE_POLL_MS` | 10s / 20ms | Bound observable decision/retry readiness, not fixed sleeps |
| Browser `integration.mjs` | `BROWSER_STATE_GUARD_MS` | 10s | Unchanged readiness watchdog, not a fixed wait |
| Browser `firefox-process.mjs` | `SHUTDOWN_GRACE_MS` | 300ms | Unchanged graceful-stop budget before forced cleanup |
| Browser `firefox-isolation.mjs` | `ACTIVITY_GUARD_MS` | 3s | Bound waiting for a worker request to connect/disconnect; return immediately on the event |
| Browser `firefox-isolation.mjs` | `CASE_GUARD_MS` | 15s | Bound each real-browser isolation regression, not a fixed wait |
| Browser `firefox.mjs` / `firefox-transport.mjs` | `TIMEOUT` | 15s, unchanged | Startup-stage and WebDriver command watchdogs; cancellation interrupts them without waiting for expiry |
| Browser `firefox-timeout.fixture.mjs` | `CASE_GUARD_MS` | 1s | Deliberately expire a fake-browser case to verify Node watchdog cancellation; no real browser is launched |
| Browser `firefox-suite.test.mjs` | `RUNNER_GUARD_MS` | 5s | Bound the independent child runner that exercises the deliberate one-second timeout |

Production deadlines and polling intervals are not test-tuning settings.
Worklog retains its three-second lock timeout and 20ms polling; WT retains its production caller deadlines and 5ms polling.

## Unchanged timing audit

- Bun package/harness tests use process watchdogs, not deliberate successful-path sleeps; their real harness startup and repeated WT/Git operations remain the main costs.
- Evaluation CLI timeout cases retain `--timeout 1`, the public interface's minimum, to preserve end-to-end failure diagnostics, exit status, output limits, and snapshot cleanup coverage.
  Moving those checks to a lower layer or adding a test-only production override was not necessary for this pass.
- Fake reviewer/provider sleeps of 8, 12, 30, or 60 seconds intentionally outlive cancellation; successful tests interrupt them rather than paying those waits.
- Readiness polls and PTY `select`/`wait` limits in the remaining fixtures are already short or return on events; no blind reduction was applied.
- Firefox startup, WebDriver request, network, and CLI watchdogs remain unchanged; lowering them would not accelerate successful operations and could worsen startup flakes.
- Production clocks, polling intervals, and CLI timeout validation remain unchanged.

## Verification for each adjustment

1. Adjust one setting or one explicitly coupled group, without removing assertions.
2. Repeat affected cases sequentially and with bounded concurrency; record pass counts and timings.
3. Deliberately disable the relevant locking/cleanup behavior and confirm the tests fail for the intended reason, then restore it.
4. Run the affected Rust suite and `make lint`.
5. Keep the full package gate and restricted change review as final checkpoints before calling the overall task complete.

Useful focused filters:

```sh
cargo test --locked --offline --manifest-path tools/worklog/Cargo.toml a_short_lock_deadline
cargo test --locked --offline --manifest-path tools/worklog/Cargo.toml a_waiting_writer
cargo test --locked --offline --manifest-path tools/worklog/Cargo.toml a_cli_writer_reports_success
cargo test --locked --offline --manifest-path tools/worktree/Cargo.toml process::tests
cargo test --locked --offline --manifest-path tools/evaluation/Cargo.toml --lib reviewer_process::tests
node --test --test-concurrency=1 tools/artifact-review/tests/firefox-{process,suite,startup,transport}.test.mjs
node --test --test-concurrency=1 --test-name-pattern='shared Firefox isolates|closing a Firefox case' tools/artifact-review/tests/integration.mjs
make test-browser
```
