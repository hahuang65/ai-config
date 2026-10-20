# Replacement package tests

Run `make test` from the package checkout.
Tests use disposable homes and fake providers; they must not install into the live home, import old Work log history, contact a real provider, or read saved credentials.
Provision declared tools explicitly before testing; build/test commands may fetch locked Cargo and Bun dependencies but never run mise installation themselves.
SDK tests and footer bundling discover the first pre-installed executable `pi` on an absolute PATH entry, skipping mise shims without executing them.
Pi must be installed separately (for example through Homebrew or AUR); failed discovery gives installation guidance without invoking mise or candidate programs.
Fixtures cover native CLI symlinks, supported launchers, mise shim shadowing, and missing or unusable PATH candidates without assuming a Homebrew installation.
Restricted Pi runners also skip mise shims during executable discovery while retaining reviewed-source exclusions; a Rust CLI regression and the native synthetic-provider cases cover that path.
Restricted-reviewer offline settings and synthetic-provider boundaries remain unchanged.

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
  `package-dangerous-commands.test.ts` checks formatting, host interruption, recursive deletion, process termination, and recognizable download-and-execute commands through both adapters and the generated Pi bundle.
  `package-guard-execution.test.ts` adds command-role, inherited-output, and protected-ancestor regressions through the same shared adapter fixture.
  Dangerous commands are evaluated only as strings, never executed; disposable paths cover cleanup exceptions and symlink refusal.
  `package-guard-parser.test.ts` verifies generated parser assets, native Node/Pi loading without `node_modules`, and fail-closed missing-parser and malformed-input behavior.
  `package-guard-parser-init.test.ts` checks bounded initialization and file loading, including stalled/late loaders, oversized assets, and FIFOs through both native adapters.
  `package-github-guard.test.ts` checks Claude's syntax-based read-only GitHub permission shortcut.
  See [command guard boundaries](../docs/command-guards.md) for intentional allowances and remaining gaps.
- `cli-links.test.ts` checks executable link ownership in disposable homes.
  The retired WT Python install/repeat/uninstall test was replaced by `package-install-entrypoints.test.ts`, which exercises foreign regular files and dangling links through the real shell installer and rejects the removed uninstall interface without side effects.
  Shell installation/repeat tests and the WT CLI suites retain successful installation, repeat ownership, and executable behavior coverage.
- `package-commit.test.ts` checks the commit skill's explicit authority, protected-path policy, and real Worklog CLI commands in a disposable home.
  Its 25-command scenario retains a 10s limit per command and composes a finite whole-case budget with cleanup headroom through `fixtures/commit-log.ts`.
  Regressions pin the budget and actual command count while retaining default-list omission, full-list lookup, and synthetic commit-recording assertions.
- `package-install-*.test.ts` exercises the shell installer with disposable homes and source copies, fake mise/build/tool executables, and real jq/coreutils processes.
  It covers missing dependencies, provisioning-before-build ordering and failure exit status, source/HOME separation, exact numeric preservation, ownership refusals, recorded alias upgrades, live lock contention, rollback, concurrent-edit refusal, and private record permissions.
  Cargo-style executable hard links are accepted only at catalogue paths; hard-linked source files and redirected private tool parents/files remain refused.
  Transaction failure tests inject a failing rename; the lock test waits for a real process barrier, not an elapsed-time guess.
  GNU coreutils are required; the macOS system find is also exercised.
  Multi-step ownership, transaction, rollback and modified-link scenarios compose their whole-case watchdogs from the temporary 60s per-installer limit plus setup/cleanup headroom.
  `package-install-budgets.test.ts` checks that composition; [timing evidence](timings.md#shell-installer-fixtures) records the reproduced cumulative-deadline failure.
  `package-install-performance.test.ts` verifies bounded support-metadata batching, existing-parent reuse, one staging directory per destination parent, staging cleanup, and file-versus-directory traversal in one instrumented installation.
  Its six independent fault cases cover failed/truncated metadata, hard links, oversized files, symlinks, and a file-to-symlink swap at the metadata boundary.
  `package-install-staging.test.ts` refuses directory/symlink substitution and a metadata command that prints a matching identity but fails before another write.
  It also preserves unexpected staging entries and checks that private recovery state and the blocking lock remain.
  Negative controls instrument both link creation and file copying, so unsafe staging reuse fails for attempted writes rather than only diagnostic wording.
  The existing failed-switch regression also rejects reuse of an occupied staging entry during rollback.
  Disposable negative controls restore each process-overhead regression separately and must fail the combined successful-installation check.
  [Paired installer measurements](timings.md#installer-process-overhead-checkpoint-365) document the process-count reductions and verification limits.
  Applicable Rust installation-library scenarios have moved to these suites; unrecorded-adoption cases and private implementation tests are deliberately retired, not counted as retained coverage.
  See the [coverage migration](installer-migration.md) for the behavior-to-suite mapping.
  Rust data-only catalogue checks call the production JSON filter directly with a 10s watchdog, while filesystem and installation scenarios retain the real shell installer.
  Scenarios that already install read their own completed ownership record instead of performing another installation for expected data.
  Change-review rendering and runner-diagnostic fixtures use independent uninstalled homes; representative regressions reject accidental installation before and after their review behavior.
  No installed-home or successful-test cache is used.
  Both native harness discovery checks retain the real shell fixture, without skipping when an obsolete binary is absent.
- `package-tool-inventory.test.ts` checks catalogue coverage for manifest CLI aliases, the current Rust executable source layout, literal Pi tool registrations, and bare Claude tool denials.
  It does not contact MCP servers or assert that a documented host tool is active in every session.
- `package-harness-contracts.test.ts` checks every manifest resource destination-to-source mapping, settings destination/path, the complete registry policy matrix, and local source-reference links.
  It rejects undocumented added/renamed routes reusing existing sources and preserves the positive local-documentation contract without the retired external destination.
  These are documentation completeness and navigation checks, not semantic parity, live-installation verification, or model-compliance evidence.
- `resolve-conflicts.test.ts` checks the rebase-only skill contract.
- Every `tools/evaluation/tests/*.rs` integration suite runs, including package validation, configuration ownership, frozen evidence, restricted reviewers, consultations, and human-confirmed comment-only publication with disposable fixtures and fake providers; no hand-maintained suite allowlist can omit new safety tests.
- `package-review-gate.test.ts` checks the complete and focused gates, shared executable build prerequisites, bounded ordinary-package/installer/WT worker selection, and grouped evaluation case wiring.
  `package-ordinary-workers.test.ts` and `package-installer-workers.test.ts` share fake Bun processes through `fixtures/bun-workers.ts` to prove overlap, serial ordering, automatic file discovery, exact-once assignment, empty-group refusal, and failure propagation through prefixed output.
  The ordinary-worker cases also prove that installer and native-runtime files stay excluded.
  Nested gate-check regressions supply inherited serial Make settings; both default/explicit preview checks isolate those settings before asserting their own worker counts.
- `tools/evaluation/tests/cases/change_progress.rs` checks timestamped step starts/ends and durations, live Pi/Claude evidence-read activity, elapsed-time updates, bounded output, private-output filtering, and silent JSON mode.
  `change_progress_terminal.rs` verifies the running log and overall stage/time bar through a real pseudo-terminal.
- Rust tests and `tools/worktree/tests/rust_parity.py` check the standalone worktree CLI, including the process-level ownership, cleanup, interruption, and submodule cases; Rust tests also check Worklog.
- The original Python worktree CLI's reference-only tests are not part of the replacement gate; the parity runner executes their applicable cases against the Rust CLI.
- `tools/artifact-review/tests/` checks local review storage, revision-bound per-finding repair decisions through the Rust CLI, and the bounded Firefox integration after an explicit debug CLI build.
  Its real change-report case covers Accept/Reject, annotations, retry after response loss and reload, and preservation of the retained HTML; ordinary artifact approval keeps its existing coverage.
  `publication.mjs` separately checks exact preview then human browser confirmation, independent repair decisions, account/PR/report changes, rejected field injection, local-origin authorization, and reconciliation after a lost fake-provider response without a second post.
  It also checks the original Scope and intent PR anchor, Markdown section headings, and confirmed-versus-uncertain publication banners.
  `link-navigation.mjs` checks that only safe GitHub PR anchors survive sanitization, without enabling document scripts or other navigation.
  `submission-status.mjs` checks readable submitted/completed pages, reload persistence, agent replies, changed versions, and reopening without stale completion labels.
  The artifact tool links the shared evaluation library; these cases never access a live provider or protected legacy publication state.
  `tests/wait.rs` covers manual compatibility waiting, transport heartbeats, terminal state, replay/retry, interruption/shutdown, and fresh revision checks despite render reuse.
  `feedback*.rs` cover durable jobs, exact origin routing, receipt validation, attempt fencing, native listener notification, and active lease renewal.
  Native Pi and Claude feedback fixtures prove idle delivery, busy sequencing, browser replies, Markdown-safe completion, and orphaned-claim recovery with synthetic providers.
  Evaluation's `feedback_response.rs` covers restricted standalone responses, cancellation, no idle model call, retained discussion context, and CLI launch-mode selection.
  `standalone.mjs` checks readable local reports without repair controls through the bounded Firefox harness.
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
The package target first runs ordinary files through `test/packages.mk` with two isolated Bun worker processes.
That stage excludes `test/package-install-*.test.ts`, `test/package-worktree.test.ts`, and `test/package-claude-worktree-runtime.test.ts`.
Claude hook lifecycle, Claude/Pi discovery, reviewer runtime, and Pi LSP transport share one group; every remaining eligible ordinary file is discovered automatically into the other group.
Each worker executes its own cases serially; process-global environment changes cannot cross worker boundaries.
`PACKAGE_TEST_JOBS=1` schedules these ordinary groups serially.
The gate then runs installer files through `test/installers.mk` with two Bun worker processes, each retaining serial case execution.
Rollback, record, path, performance, entrypoint, lock, and upgrade files form one installer group, balanced against the new staging safety cases and the remaining automatically discovered files.
All worker groups are phony targets, so every invocation reruns them without a successful-test cache.
Output lines carry `[package 1]`/`[package 2]` or `[installer 1]`/`[installer 2]`; pipeline failures propagate instead of being hidden by output prefixing.
`INSTALL_TEST_JOBS=1` schedules the installer groups serially, and either worker setting rejects values other than 1 or 2 before commands run.
The worker limit counts Bun processes; the lock fixture still launches its own controlled competing installer.
After both installer workers finish, the Pi and Claude runtime files each run in their own invocation with `--concurrent --max-concurrency=2`.
The ordinary-package, installer, Pi, and Claude stages never overlap with one another, and the gate lists every test file exactly once.
The three complete Pi runtime scenarios keep separate Node processes, temporary homes, repositories, and worktrees; the file's two read-only package checks run in the same bounded group.
The two native Claude scenarios keep separate sandboxed processes, homes, repositories, session histories, and loopback fake API servers.
Their assertions, watchdogs, platform skips, and independent harness configuration are unchanged.
Browser integration remains serial.
For serial ordinary-package diagnosis, use `make test-package PACKAGE_TEST_JOBS=1`.
For serial installer diagnosis, use `make test-package INSTALL_TEST_JOBS=1`.
Set both variables to 1 to serialize both file-worker stages without changing the separate native-runtime groups.
For serial native-runtime diagnosis, use `bun test test/package-worktree.test.ts` or `bun test test/package-claude-worktree-runtime.test.ts` after building this checkout.
Browser-based cases share one lazily started Firefox process and temporary profile for the suite, with at most one case active.
Firefox uses Linux PATH or the macOS application fallback, with `FIREFOX_BIN` taking precedence on either platform.
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
Run the group with `cargo test --locked --manifest-path tools/evaluation/Cargo.toml --test change`.
Add a module-name filter such as `change_post_safety::` to focus it, or append `-- --test-threads=1` for serial debugging.
`change_execution.rs` uses the real artifact helper for opener-safety checks; prepare `make build build-evaluation-debug` before running that group directly.
Its executable exclusion scenarios reuse one disposable setup within the scenario instead of repeating installer setup for every executable.
The reviewer and consult cases similarly share `tests/runners.rs` rather than four separate integration binaries.
Their case modules are `cases/{consult,reviewer,reviewer_claude,reviewer_diagnostics}.rs`; the fake reviewer script lives in `support/reviewer.rs`.
All cases retain their assertions, deadlines, and separate disposable homes, repositories, provider state, and output files.
First run `make build-evaluation-debug` to build the test-only reviewer driver, then run `cargo test --locked --manifest-path tools/evaluation/Cargo.toml --test runners`, optionally filtering a module such as `reviewer_diagnostics::` or appending `-- --test-threads=1`.
Shell-backed package and installation cases share `tests/configuration.rs` and the existing Rust test-thread limit.
They live in `cases/configuration_package*.rs` and `cases/package_*.rs`; no Rust installation library remains.
The package-manifest helper runs `install.sh` in a disposable home and reads its completed ownership record rather than duplicating validation or effects.
Every case retains its separate disposable installation source, home, ownership record, lock, and output files; shared package inputs remain read-only.
Run the group with `cargo test --locked --manifest-path tools/evaluation/Cargo.toml --test configuration`, optionally filtering a module such as `configuration_package_resources::` or appending `-- --test-threads=1`.
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
A further process-boundary test verifies Python-reference output preserves surrogateescaped Unix path bytes even with strict stdout encoding, without requiring APFS to create invalid UTF-8 filenames.
The non-UTF-8 ownership lifecycle test retains its filesystem-dependent skip on macOS and expects integrated Rust task branches to be deleted.
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
