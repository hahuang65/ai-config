# Test-duration tuning checklist

These are the lock, subprocess, and browser-fixture durations adjusted during the test-gate speed work.
Edit the named constants in the linked files; shell fixture delays are derived from those constants too.
The values below are the current settings, not promises that lower values will be reliable.
Update this list whenever a setting changes.
Checked rows mean the documented setting was audited against source and retained through the full gate, not that further reductions are safe.

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

## Shell installer fixtures

| Check | Constant | Current value | Source and purpose |
| --- | --- | --- | --- |
| Retained | `INSTALL_COMMAND_GUARD_MS` | 30s | [install-script.ts](fixtures/install-script.ts): unchanged subprocess limit for one installer transaction |
| Adjusted | `SOURCE_SWITCH_GUARD_MS` | 180s | [package-install-switch.test.ts](package-install-switch.test.ts): five sequential installer limits plus one 30s fixture setup/cleanup margin |

The source-switch scenario covers initial installation, repeat installation, switching sources, switching back, and recovery after removing the former source.
Its previous 40s whole-case watchdog was shorter than the combined subprocess budgets and left no headroom on a measured local run of about 40s for five successful transactions.
The new watchdog derives from the existing per-command limit; it does not add successful-path waits or change installer behavior, transaction limits, or assertions.

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
