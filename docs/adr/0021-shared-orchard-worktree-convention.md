# Keep development worktrees in one shared orchard

> **Flat-layout naming superseded by [ADR-0023](0023-use-hybrid-pooled-branch-bound-worktrees.md):** Orchard now supplies the enclosing project group and receives the same concise `<short-intent>` used as the branch suffix.
> The decision below remains the historical rationale for making worktree naming predictable.

Agent-created worktrees were previously placed ad hoc, which made them difficult to discover, distinguish from primary checkouts, and clean up safely.
A worktree convention must be available before the first worktree is created, so loading it only with detailed Git rules is too late.

## Decision

Create development Git worktrees under `~/.orchard/`.
Name each worktree `<project-basename>-<short-intent>`, where the intent is concise and specific enough to distinguish concurrent work.
Review change isolation is operational rather than development work and uses `~/.review-orchard/` instead, as recorded in ADR 0022.
Keep this convention in the small always-on harness bootstrap alongside the existing feature-branch naming rule.
Workflows may remove only the exact worktree path they created and recorded; they do not own other orchard entries or repository-wide pruning.

## Consequences

- Development worktrees from different projects are discoverable in one predictable location.
- Disposable Review change worktrees cannot be mistaken for active development worktrees.
- A path communicates both its source project and its purpose.
- Cleanup can be path-scoped without guessing whether a checkout is user-owned.
- The always-on bootstrap grows by one short operational rule rather than loading the full Git rulebook.
