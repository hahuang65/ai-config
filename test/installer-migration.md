# Installer coverage after legacy retirement

The installation entry point is `install.sh`, not a Rust library API or a captured historical installer.
[ADR 0041](../docs/adr/0041-retire-unrecorded-installation-adoption.md) explicitly retires adoption of unrecorded legacy installations while retaining recorded upgrades.
The former 121-case Rust configuration group now contains 43 catalogue-filter, shell-backed package, and installation cases.
Other applicable scenarios moved into the Bun shell-process and JSON-filter suites below; raw case counts are not a claim of unchanged coverage.

| Former behavior or implementation | Current evidence / disposition |
| --- | --- |
| Package catalogue, harness isolation, selected settings, permission floors | `tools/evaluation/tests/cases/configuration_package*.rs` and `package_manifest.rs` exercise the production `native_package` JSON filter directly for data-only assertions. Full installation cases still verify the resulting ownership record and materialized links. |
| Required source resources, skill metadata, executable modes, local LSP definition, theme installation | The filesystem cases in `configuration_package*.rs` retain real shell installations in disposable homes. The real-checkout release-build check and relocated-package installation remain end-to-end. |
| Public installation, model/settings preservation, recorded source upgrades, command-alias migration | `tools/evaluation/tests/cases/package_{install,config_cli,command_migration}.rs`; native harness discovery also uses `install.sh`. |
| Version-one records, missing owned resources, invalid/future records, exact link targets, unrecorded collisions, native preference edits, byte/inode/mode-preserving repeats | `package-install-records.test.ts`, `package-install-entrypoints.test.ts`, and `package-install-safety.test.ts`. |
| Repeated source switches, absent old sources, obsolete-link pruning/refusal, unrelated files and independent links | `package-install-switch.test.ts` and `package-install-upgrade.test.ts`. |
| Invalid destinations, private preference ownership, malformed claims, required permissions and hooks | `package-install-manifest.test.ts` exercises the production catalogue and record filters. |
| Scalar/array ownership, duplicate/missing/modified entries, order, fractional values, numerically equivalent spellings, distinct large integers, unknown subtrees | `package-install-json.test.ts` exercises the lossless JSON and settings filters, including repeated switch/removal. |
| Redirected parents, settings, records and locks; special files; malformed/duplicate/overdeep/oversized JSON; source/HOME overlap; private diagnostics | `package-install-paths.test.ts`, `package-install-safety.test.ts`, and `package-install-script.test.ts`. |
| Resource traversal bounds | `package-install-paths.test.ts` uses a controlled 100,001-entry find stream and an actual 129-level resource tree; package resource tests retain redirected/special-file refusals. |
| Failure during second-harness placement, settings replacement or record replacement; restoration of removed links, original bytes/modes and ownership | `package-install-rollback.test.ts` injects rename failures during real source switches and fresh installation. |
| Native edits after preflight or during rollback; exact-destination replacement; retained private recovery files | `package-install-rollback.test.ts` and `package-install-transaction.test.ts` inject deterministic filesystem interleavings without timing guesses. |
| Installer exclusion and lock lifetime | `package-install-lock.test.ts` tests the shell lock directory with process barriers; the deleted Rust file-lock/fork regression is implementation-specific, not evidence for this different protocol. |
| Shared private staging, safe reuse, leftover values and cleanup refusal | `package-install-performance.test.ts` counts one directory per destination parent and checks cleanup. `package-install-staging.test.ts` refuses substituted directories/symlinks and failed identity commands before writes, and preserves unexpected entries with private recovery state. The existing failed-switch cases require rollback past an uncommitted staging value. |
| Historical shared/evaluation inventories, legacy symlink detachment, adoption flags/preflight and adoption rollback | Deliberately retired with the operation; `package_install.rs` checks that legacy flags are rejected without creating home state. |
| Captured legacy installer execution | Removed; only the integrity-checked Claude permission-floor JSON remains as passive evidence. |

The Rust `support/package_manifest.rs` helper separates three boundaries.
`catalogue_manifest` runs the production JSON catalogue filter with a 10s watchdog and performs no installation or source-filesystem validation.
`prepared_manifest` runs the real shell installer in a disposable home, while `installed_manifest` reads an existing completed installation record without another transaction.
These helpers do not reimplement ownership decisions or filesystem effects, and no successful-test results or installed homes are cached.
Theme, guarded-package, and relocated-package scenarios inspect their own completed installation rather than installing into another home just for expected data.
Review rendering and runner-diagnostic fixtures retain independent disposable state but no longer install unrelated resources; regressions verify that successful review behavior needs no installation ownership record or managed links.
Normal installer fixtures stub compilation; fault cases additionally substitute selected filesystem commands to force the documented failure or interleaving.
The separate test-only `reviewer-fixture` driver exercises the unchanged restricted-runner library and is not a production executable.

Focused checks do not replace `make lint` and `make test`.
A negative control that disables the shell's before-write comparison must fail the native-edit-after-preflight regression; restoring that comparison must pass.
These tests do not install into a live home, remove protected services, or establish model obedience.
