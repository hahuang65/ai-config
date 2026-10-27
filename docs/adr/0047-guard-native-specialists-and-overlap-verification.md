# Guard native specialists and overlap verification

Status: accepted.

## Problem

Pi does not supply ordinary delegation merely because shared role files are installed.
A full third-party orchestration configuration would introduce writers, background work, worktree allocation, and workflow state beyond the required read-only assistance.
Serial review and checks also add elapsed time, while repeated delivery checks duplicate a successful commit gate.
Delegating a deterministic test command to another model would not make the suite itself faster.

## Decision

Use pinned pi-subagents 0.83.0 as the native execution engine behind one small owned facade.
Expose only four curated specialist names and a bounded task string.
Preserve the canonical role bodies and Claude metadata.
Register separate private runtime names, inherited instructions and skills, four read-only builtin tools, and mandatory guard/WT/review-feedback extensions.
Keep calls foreground, fresh, model-only, and sequential.
Hide the engine's auxiliary tools and disable its unrelated optional features.
Do not make `change-reviewer` an ordinary delegated role.

Preserve the package layout and licenses in ignored build output.
Use peer links to the already installed Pi SDK rather than downloading a second client or bundling host libraries.
Record the host identity and check it and the owned policy before each delegation.
Private malformed policy errors must not quote their contents.
The existing shell installer owns the adapter and policy links, refusing unrecorded collisions.
No upstream installer, ordinary resource-discovery restriction, or live source switch is implied.

At implementation completion, finish source-producing builds first, then overlap independent checks with the existing restricted review when safe.
Use bounded native subprocesses and separate logs.
Wait for both results before repairs or source edits and recheck source freshness.
Keep browser/test resource limits and the human finding-decision workflow unchanged.
This repository exposes `test-prepared` after an explicit current build and debug-support preparation.
It shares every assertion recipe with normal `make test`, omitting only the source-producing prerequisites.
The ordinary gate and commit hook remain unchanged; no environment flag can silently put them into prepared mode.

Commits always run required checks, using their known normal hook where appropriate.
Never bypass a hook or use earlier verification to skip a commit gate.
Delivery reuses actual evidence only for the same clean checkout, exact revision, required commands, and relevant configuration/toolchain state.
A real rebase invalidates that verification, including a rewrite whose final file tree is unchanged.
Rerun invalidated checks after rebase and before integration, not after integrating an unchecked revision.
A no-op rebase preserves matching evidence.
Remove the blanket prohibition on delivery-time provider review, but do not require a duplicate review or infer missing review/publication authority.

## Alternatives and consequences

Installing the full package defaults was rejected because role labels and optional-feature switches are not a read-only permission boundary.
Writing another orchestration runtime was rejected in favor of the package's public agent-registration, extension-floor, and capability-ceiling APIs.
Running tests through a shell-enabled specialist was rejected because it adds model orchestration without reducing test execution time.
A persistent verification cache and hook bypass were not introduced.
The shared workflow remains guidance executed through existing native tools, not a new scheduler or proof of model compliance.

A read-only specialist is not snapshot-confined and is not an operating-system sandbox.
Loaded extensions remain trusted code, and guard patterns are not exhaustive credential protection.
Native sessions and artifacts still use the package's private persistence.
SDK changes require rebuilding against the active host, and real-provider quality and lifecycle behavior need their own evidence.
A long-running test suite remains long-running, and resource contention can limit overlap gains.
Source delivery, live installation, commits, human repair decisions, and publication retain their separate authority.

The detailed source contract and evidence limits are in [native specialists](../native-specialists.md).
Restricted feedback and publication remain governed by [ADR 0044](0044-native-background-review-feedback.md) and [ADR 0043](0043-separate-pr-publication-from-local-repairs.md).
