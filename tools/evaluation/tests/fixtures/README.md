# Frozen permission-floor input

`legacy-claude.json` retains the Claude settings capture from `ai-config` commit `2f04c8f0600f1abc72e83409f2ba0a831af915cc`.
It is read only to compare the package's permission floor with that historical baseline; its commands are never executed.
The capture contains no saved credentials or real conversations.

Formatting newlines were removed without changing values or numeric tokens.
The original formatted SHA-256 was `09387394b39ad75ef71fe6a6b7f30078c1a6679a8c6a1080c9c2f8f390722b4d`.
The retained compact SHA-256 is `d1632b311ad03230b5a8027d92d54593e7bc3c5413ec569f0909b24bd97843b9`, checked by `support/package_fixture.rs` before use.
Do not rewrite this capture to make a changed permission floor pass.

The old installer scripts, layout inventories, and adoption fixtures were removed with the explicitly retired unrecorded-adoption mode.
Current package and installation tests exercise `install.sh` in disposable homes; they do not replay an alternative installer or prove live service retirement.
See [ADR 0041](../../../../docs/adr/0041-retire-unrecorded-installation-adoption.md).
