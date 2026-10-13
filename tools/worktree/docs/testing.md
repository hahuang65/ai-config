# WT verification

## Reference toolchain

Use mise-managed Rust 1.99.0 and Python 3.11.4 for the full gate.
Python is a compatibility-test dependency, not a WT runtime dependency.
The tests compare Rust output and exit status with the retained Python implementation.
Python 3.11.17 changes the handling of `list -hfoo`; Python 3.12.15 also changes option termination and diagnostic formatting.
These interpreter changes produce parity failures without a WT source change.
Do not weaken assertions or change the installed Rust command to follow the host interpreter.

```sh
python --version
rustc --version
make test
make lint
```

## Fixture isolation

The ownership-byte fixture uses `tempfile` to allocate its directory atomically.
A deterministic regression creates two fixtures with the same name prefix and verifies that removing one does not remove the other's files.
It failed with `AlreadyExists` before the fix.
The existing ownership-byte assertions and normal parallel test execution remain unchanged.
The new test adds one Rust case and less than one second to a warm run.

```sh
cargo test --locked ownership -- --test-threads=8
```

## Submodule checkout identity

Two Rust executable cases cover a submodule whose administrative name differs from its checkout name.
They verify listing, task naming, entry, return-before-cleanup, retained branches, and an unchanged parent repository.
A missing main checkout must stop listing and cleanup rather than adopting the current task as the main checkout.
These are corrected Rust behaviors; the retained Python reference is unchanged.
The cases add about four seconds to a warm macOS gate and require no network.

## Platform evidence

On 2026-10-08, the macOS gate passed 152 WT tests with two explicit filename skips.
The complete Pi evaluation gate using this WT change passed 486 tests with the same two skips.
Formatting and strict Clippy passed.

A separate Linux ARM64 container ran the full WT gate with Rust 1.99.0, Python 3.11.4, and Git 2.47.3.
All 154 WT tests passed: 58 retained Python cases, 13 Rust cases, and 83 Rust executable cases.
There were no Linux skips, and formatting and strict Clippy passed.
Both non-UTF-8 filename cases ran successfully, including ownership, entry, listing, cleanup, and branch retention beneath a non-UTF-8 parent.
This closes the missing Linux evidence; macOS still cannot create those filenames.

The container received selected source files through an archive, not host credentials, configuration, Git metadata, or worktree mounts.
Mise compiled Python 3.11.4 from source because the old prebuilt artifact has no GitHub attestation.
Attestation verification was not disabled.
These results cover WT on Linux, not the complete Pi, Herdr, and Firefox evaluation on Linux.
