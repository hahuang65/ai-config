# Captured legacy installer inputs

These files preserve the default installer recipes used to check the legacy resource inventories.
They are test inputs, not installer entry points.
Never run them against a real home.

## Shared AI configuration

`legacy-shared/install.sh` and both `manifest.sh` files come from `ai-config` commit `2f04c8f0600f1abc72e83409f2ba0a831af915cc`.
`source-tree.json` records the shared directory, agent, and command names consumed by that version's shell globs.
The captured settings are stored once under `tools/evaluation/src/configuration/legacy_defaults/`, because production ownership claims must also use those fixed defaults.
The Claude JSON capture has formatting newlines removed; its values and numeric tokens are unchanged.
Its original, formatted SHA-256 was `09387394b39ad75ef71fe6a6b7f30078c1a6679a8c6a1080c9c2f8f390722b4d`.

The fixture constructs an isolated source tree and home, supplies an inert Pi location, and replaces both service installers with recording stubs.
It executes the captured root installer and checks its resulting links against the inventory.
This proves the harness-resource projection, not service installation or service retirement.
The agentmemory executable alias is tested separately because its real service installer is not executed.

## Evaluation configuration

The retired evaluation Makefile and installer are not replayed.
`package_install.rs` tests adoption of their explicitly owned links and preservation of private state in disposable homes instead.

## Integrity and limits

`tests/support/captured_installers.rs` checks the SHA-256 of every captured input before use.
Do not rewrite snapshots merely to make a changed inventory pass.
A supported historical layout needs its own evidence and declaration.
The fixtures contain no saved credentials or real conversations.
These historical captures do not establish that the current replacement resources or public installer work; the package and installation suites test those separately.
