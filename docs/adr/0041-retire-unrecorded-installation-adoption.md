# Retire unrecorded installation adoption

Status: accepted.

## Problem

ADR 0040 selected one shell installer but left a decision about the old `evaluation native-install` adoption mode.
That mode could claim explicitly declared legacy resources without an installation ownership record.
Keeping it would retain a second installer and historical layout inventories, or require adding that migration authority to the shell installer.

## Decision

Retire the one-time adoption mode rather than port it.
The user explicitly approved this boundary after distinguishing adoption from recorded upgrades.
Remove the generic `evaluation` executable, `ai-config`, their Rust installation library, and WT's separate Python installer.
The shared reviewer remains library code, with a test-only process driver rather than another production executable.

`install.sh` remains the only installation entry point.
It supports fresh installation without collisions and upgrades backed by version-one or version-two ownership records.
It refuses unrecorded links and managed setting values, even when they already match the desired source or value.
Missing ownership is not permission to reconstruct or forge a record.
A user with an unrecorded installation needs a separately reviewed manual migration, not a force flag or an alternative installer.

## Verification and consequences

Move applicable link, settings, package-validation, privacy, locking, and rollback checks to the shell installer and its JSON filters before deleting the old library tests.
Keep package validation and recorded-upgrade scenarios at the real process boundary.
Retire tests for the deliberately removed adoption operation and its private inventory, transaction, and file-lock implementation; they are not retained coverage.
The replacement lock-directory tests remain required.
Keep the frozen Claude permission-floor capture with its integrity check, but do not replay captured legacy installers.

Removing source targets does not erase stale compiled executables from other checkouts or perform a live cutover.
Old installation binaries must not run alongside the shell installer: their lock protocols differ.
Live installation and cleanup still need separate authorization.
This decision does not delete histories, worktrees, retained reports, independent TypeSafe or Herdr resources, or protected publication state.
