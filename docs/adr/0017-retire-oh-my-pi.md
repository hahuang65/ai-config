# Retire the oh-my-pi harness

The oh-my-pi harness is no longer used.
Maintaining its module, adapter, tests, installer behavior, package declarations, and script fallbacks adds a third compatibility surface without providing user value.

We retire oh-my-pi from the active harness fleet.
The `harnesses/omp/` module and its tests are deleted, the conformance and isolation suites cover only Claude Code and pi, and active documentation describes those two harnesses.
The local package and config root are removed separately from the repository change.
Historical feature documents and ADRs remain unchanged as records of the decisions that led to the current guard-core architecture.

## Consequences

- Claude Code and pi are the only supported harnesses.
- The shared guard core remains the source of truth for enforcement, with one adapter per supported harness.
- The generic module installer remains unchanged: retiring a harness is deleting its module.
- Shell helpers invoke pi directly rather than falling back to oh-my-pi.
- Linux bootstrap no longer installs `oh-my-pi-bin`.

This ADR supersedes the active oh-my-pi support portions of ADR-0002 through ADR-0006 and ADR-0010 through ADR-0012.
Their historical rationale remains useful and is not rewritten.
