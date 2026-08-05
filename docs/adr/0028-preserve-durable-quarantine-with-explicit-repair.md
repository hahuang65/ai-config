# Preserve durable quarantine with explicit Orchard repair

A task worktree's branch binding remains fail-closed: a detected mismatch creates structured durable quarantine, and refresh never clears it merely because the expected branch appears restored.
Shared harness guardrails block recognizable direct branch-binding changes under `~/.orchard/`, while manual Git remains an escape hatch because Git has no portable pre-switch hook.
Orchard restores only a recorded branch-mismatch quarantine through explicit `orchard repair`, after independently verifying the registered project, path, expected branch, Git worktree metadata, uniqueness, stable Git operation state, and absence of conflicting live ownership.

## Consequences

- Repair is available from the exact quarantined worktree or its main project directory, with intent required when the path cannot identify the slot.
- Ordinary dirty task files do not block repair, but an in-progress Git operation or multiple live owners do.
- Successful repair changes only Orchard metadata, preserves an audit record, and reports rather than deletes the observed accidental branch.
- Normal status output exposes quarantined paths, expected and observed branches, and reasons; structured output also exposes reason codes and timestamps.
- Repair completion lists only eligible quarantined worktree intents.
