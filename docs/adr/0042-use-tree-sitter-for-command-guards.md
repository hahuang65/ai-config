# Use tree-sitter for shared command inspection

## Context

Expanding dangerous-command checks exposed repeated mistakes in handwritten shell parsing: quoted examples looked executable, multiline substitutions hid commands, and redirects were mistaken for utility arguments.
The shared-policy architecture from [ADR-0011](0011-guardrail-policies-ports-and-adapters.md) remains appropriate, but its command detectors need one authoritative syntax representation across Claude/Bun and Pi/Node.

## Decision

Use tree-sitter-bash through web-tree-sitter WASM for all shell structure consumed by the guards, including existing policies and Claude's read-only GitHub shortcut.
Retain policy-specific interpretation of utility options, paths, and non-shell program content.
Explicitly reparse syntax-proven literal shell programs rather than treating every quoted argument as executable code.

Pin build dependencies and their integrity records in `package.json` and `bun.lock`.
`make build-guard-parser` restores frozen library dependencies with lifecycle scripts disabled, then regenerates the local runtime, grammar, and licenses in `guard/vendor/`.
The Pi bundle includes the JavaScript runtime; both adapters load WASM from the checked package source rather than downloading it or resolving installed Node packages.
Initialization is asynchronous at the adapters; policy evaluation and its bounded, decision-local syntax representation remain synchronous.
Parser failures refuse Bash rather than switching back to text matching.

## Consequences

We add a third-party grammar and WASM runtime to the package and its source validation requirements.
Builds may fetch locked Bun library dependencies, just as Cargo may fetch locked dependencies; neither provisions tools nor installs harness resources.
Dependency updates require explicit review, regeneration, and cross-runtime verification.

The grammar removes our responsibility for shell statement boundaries and quoting, not for every utility's semantics or for runtime shell evaluation.
Unknown expansions, arbitrary script contents, aliases, and filesystem races remain outside a complete execution-safety guarantee.
Oversized or malformed programs are refused even if a human could determine they are harmless.
See [command boundaries and limits](../command-guards.md) for the operational contract and regression suites.
