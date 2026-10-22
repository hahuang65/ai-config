# Share review state across task builds

## Problem

Review helpers previously selected their default state from the source checkout used to compile them.
A task-worktree helper could save a finding decision in one directory while the installed harness adapter searched the primary checkout's directory.
The browser showed a durable Accept, but feedback remained queued with no originating responder attached.
This was not delegation to a standalone repair agent.

## Decision

Resolve the default `.state/reviews` directory from the package repository's verified primary Git checkout.
Keep primary-checkout state in its existing location, so new task builds interoperate with the installed helper without changing installed configuration.
Verify that Git's canonical worktree root equals the package source before trusting its identity.
Resolve absorbed submodules in their own Git context and verify the primary checkout shares the source repository's Git common directory.
Do not derive state identity from the reviewed repository or the invoking working directory.
Use the shared source-excluding executable resolver for read-only Git discovery, preserving inherited exclusions and startup-environment cleanup.
Bound discovery and cache its result for one helper process.

An explicit `AR_ROOT` still overrides discovery completely.
Source exports without their own Git metadata retain package-local state.
Broken or unavailable Git metadata, including dangling symbolic links, fails rather than choosing another implicit queue.
Independent clones remain independent unless a human explicitly selects a shared root.

Provide `recover-state FILE --from-root ROOT` for one older worktree-local store.
Require a stopped server, no active feedback lease, private regular files, an empty destination, and an atomic same-filesystem directory move.
Retain the SQLite store and journals unchanged rather than copying or replaying events.
Never merge two stores, change a feedback origin, synthesize an Accept, or migrate unrelated artifact state.
Reopen the same artifact so the native adapter attaches through a fresh opaque receipt and claims the retained job normally.

## Alternatives

- Add state-root paths to attachment receipts: would require adapter updates before repairing compatibility with the installed adapter.
- Move all state into a new home directory: would require migrating existing primary state without helping the installed helper find it immediately.
- Spawn a new responder: would violate the originating-conversation repair boundary.
- Recreate the review and ask for another Accept: would discard the useful saved authorization instead of repairing delivery.

## Consequences

A task build can be tested without changing installed links, binaries, settings, or authentication.
Review runtime state is intentionally shared with the primary helper when no override is set.
Tests must continue to use explicit isolated roots.
Recovery moves only an explicitly selected stopped review and leaves old routing registries untouched.
Hard-link alias detection remains excluded by the user's review decision, not claimed as a verified fix.
Unavailable old inboxes remain subject to the existing skip-without-reopening policy.
Subprocess and source-recovery failures remain visible instead of being mistaken for an empty inbox.
