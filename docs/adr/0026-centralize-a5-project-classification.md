# Centralize A5 project classification

Commit staging, pull-request trust, and delivery policy all need to recognize the same private project family.
Repeating its filesystem convention in each skill and rule risks classification drift, especially when the active checkout is an Orchard worktree or disposable review copy outside the originating project directory.

We define **A5 project** once in the always-loaded harness baseline.
Classification uses the originating repository's canonical main project directory resolved from Git worktree metadata.
Linked worktrees retain their main project's classification, and disposable review copies retain the originating repository's classification rather than using the copy path.

Skills, prompts, and advisory rules refer only to “A5 project.”
The harness baseline is the sole active workflow source that records the filesystem convention.

## Consequences

- Commit, review, and delivery workflows share one classification.
- Orchard worktree paths do not hide A5 project identity.
- Disposable review paths do not accidentally grant or remove A5 trust.
- Changing the project-family convention requires one baseline edit plus its focused tests.
