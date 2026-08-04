# Move policy-aware delivery into Orchard

Delivery synchronization, rebasing, local integration, pull-request publication safety, return, and cleanup are deterministic lifecycle behavior that should work identically outside an AI harness.
Keeping those mechanics in a deliver skill made manual Orchard use less capable and left safety policy as model instructions rather than executable tests.

The standalone Orchard CLI owns `orchard deliver` and selects `local` or `pull-request` from trusted user or system Git configuration.
The A5 Git include supplies `ai.projectFamily=a5` and `orchard.deliveryStrategy=pull-request`, making effective Git metadata the shared machine-readable classification source.
Repository-local configuration cannot select a mutating delivery strategy.

`orchard rebase [intent]` and `orchard deliver [intent]` infer the current managed task inside its worktree or accept a worktree intent from primary trunk.
Local delivery invoked from primary trunk integrates and recycles immediately when safe.
Task-worktree delivery returns through the existing managed-shell or harness transition before cleanup.
People finalize an interrupted return with `orchard deliver --finalize <intent>`, while adapters retain an internal operation ID for stale-request protection and idempotency.

Interactive Orchard delivery always shows concise dirty status and asks whether to commit.
Staged-only state opens ordinary `git commit`; unstaged or untracked state opens `git commit --interactive` so Git owns user-selected staging and the configured editor, template, hooks, and signing.
Declining exits unchanged, and noninteractive `--json` returns `needs-commit` without prompting or committing.

The public `orchard merge` command is retired because it could bypass configured pull-request delivery.
Local fast-forward integration remains an internal Orchard service.
Pull-request delivery records configured-upstream and same-named remote tips before rebasing, refuses ambiguous or rewritten publication, and runs exactly `git pr create --web --fill` only when safe.
It reports `pr-form-opened` and retains the task because opening a browser form does not prove landing.

The shared `/deliver` prompt delegates to the Orchard skill, invokes the commit skill only after `needs-commit`, then retries Orchard delivery.
The prompt contains no project classification, synchronization, publication, or cleanup implementation.

## Consequences

- Manual and harness delivery share one executable safety implementation.
- AI delivery retains semantic commit selection and message generation through the commit skill.
- Manual delivery can commit through Git's native interactive surfaces without Orchard auto-staging arbitrary work.
- Harness adapters still own parent-session transitions because a child CLI cannot change its parent working directory.
- Internal operation IDs remain machine-facing and never become required human input.

This ADR supersedes ADR-0023's public merge workflow, ADR-0025's decision to keep deliver as a skill, and ADR-0026's filesystem-based A5 classification source.
