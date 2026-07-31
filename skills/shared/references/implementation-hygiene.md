# Post-Implementation Hygiene

Shared reference for `code` and `coach`.
Run this after every slice is complete and the full verification loop passes cleanly.

## Hygiene sweep

Dispatch the `refactorer` agent in hygiene mode on only the changed files.
It checks dead code, unused imports and dependencies, duplicate consolidation, simplification, and language idioms without changing behavior.

The agent applies grep-verified SAFE items in small batches and reruns focused tests after each batch.
It reports CAREFUL and RISKY items without applying them.
In AI implementation mode, apply an additional reported item only when its behavior preservation is clear.
In coached mode, present CAREFUL and RISKY items to the user because they own the implementation.

After any applied hygiene change, rerun the repository verification loop.
Do not run adversarial review, database review, documentation synchronization, feature-artifact fact-checking, visual refresh, or diff review here; Review change owns final validation in build mode.

## Completion

When hygiene and verification are clean, wrap up through [implementation-completion.md](implementation-completion.md).
Never commit, stage, or push.
