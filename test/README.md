# Replacement package tests

Run `make test` from the package checkout.
Tests use disposable homes and fake providers; they must not install into the live home, import old Work log history, contact a real provider, or read saved credentials.

- `package-*.test.ts` verifies the retained skills, specialist roles, ordinary Claude and Pi discovery, guard adapters, shared commands, status displays, themes, LSP plugin separation, and review boundaries.
- `reviewer-runtime.test.ts` checks the restricted Pi reviewer with a synthetic provider and a private source snapshot.
- `guards.test.ts` checks shared guard behavior.
- `cli-links.test.ts` checks executable link ownership in disposable homes.
- `resolve-conflicts.test.ts` checks the rebase-only skill contract.
- Every `tools/evaluation/tests/*.rs` integration suite runs, including package validation, configuration ownership, frozen evidence, restricted reviewers, consultations, and human-confirmed comment-only publication with disposable fixtures and fake providers; no hand-maintained suite allowlist can omit new safety tests.
- `package-review-gate.test.ts` checks the full evaluation gate and executable build prerequisites.
- Rust tests and `tools/worktree/tests/rust_parity.py` check the standalone worktree CLI, including the process-level ownership, cleanup, interruption, and submodule cases; Rust tests also check Worklog.
- The original Python worktree CLI's reference-only tests are not part of the replacement gate; the parity runner executes their applicable cases against the Rust CLI.
- `tools/artifact-review/tests/` checks local review storage and the bounded Firefox integration after an explicit offline debug CLI build.

The package does not install task-conversation adapters or a Pi language-server client.
Runtime checks for those retired experiments are not part of the package test gate.
