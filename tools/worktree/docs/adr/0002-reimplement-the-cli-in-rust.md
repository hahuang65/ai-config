# Reimplement the CLI in Rust

## Decision

Replace WT's Python implementation with a Rust CLI while preserving the approved behavior and public protocol.
Rust is the user's preferred language for all new standalone CLI tools, including WL and the simplified artifact-review tool.
Keep Pi's required host-language adapter separate.

Do not replace the installed executable until the Rust version passes process-level compatibility and safety tests.
Keep the existing Python implementation working in the meantime.
Rust 1.99.0 was subsequently installed and pinned through mise.
The Rust replacement is now built, validated, and installed; the Python source remains as a compatibility reference.

## Reasons and alternatives

Continuing with Python would reuse the implementation, but would not meet the user's language preference.
A native executable avoids a Python runtime dependency and offers startup and execution performance opportunities.
No performance improvement has been measured; Git and network work may dominate elapsed time.

## Compatibility requirements

Preserve the four commands, argument validation, text and protocol-version-1 JSON output, bounded default inventory with an explicit full-list option, and exit statuses.
Keep diagnostics separate from machine output and prevent credentials from appearing in errors.

Retain main-checkout isolation, fetch-first remote creation, local-ahead history, explicit divergence handling, filesystem ownership checks, exclusive operation locks, and safe concurrent creation.
Do not reset existing branches or migrate uncommitted work.

Retain exact GitHub merge proof, local integration proof, tracked and nonignored-file protection, active-session Git locks, return-to-main before current-worktree removal, and branch retention.
Ignored files remain disposable only during otherwise authorized cleanup.
Do not add pools, expiry, monitoring, automatic delivery, or dependency preparation.

## Consequences

Use the existing executable tests as compatibility evidence rather than deleting or weakening assertions to fit the rewrite.
Add Rust-focused cases where necessary and retain a process boundary for public behavior.
Port or replace internal Python-only tests only when equivalent behavioral evidence is explicit.
Run the Pi adapter integration checks against the validated replacement before switching the installer or launcher.
