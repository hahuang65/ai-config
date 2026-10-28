---
name: resolve-conflicts
description: Resolve conflicts in an already-running Git rebase, preserve both changes' intent, verify the result, stage resolved paths, continue that rebase, and obtain change review. Does not start a rebase or handle merges or stash restoration.
---

# Resolve conflicts

Use only for an explicitly requested resolution of an existing rebase conflict.
A request to inspect or discuss conflicts is read-only.
An explicit resolution request includes checks, staging resolved paths, and continuation of that same rebase, unless the user limits the request to edits or another narrower scope.
It does not authorize an unrelated commit, push, integration, or cleanup.

Read [the resolution workflow](references/workflow.md) before editing.
Inspect the current Git operation and recover both changes' intent from source evidence.
Preserve compatible intent; ask in chat for a decision when the intended behaviors conflict.
Do not blindly select a side, invent behavior, or change unrelated work.

For a multi-file resolution, use an optional session checklist through available native task-list tools or ordinary chat.
Track only the authorized current rebase and its checks; the checklist cannot authorize a new operation or extra staging.
Run the project's checks and continue only the verified active rebase.
After it finishes, use [review-change](../review-change/SKILL.md) for the complete rebased task, including any remaining task edits.
Review findings do not authorize automatic repairs.
In coach mode, preserve user ownership instead of taking over implementation.
Record the operation outcome through [worklog](../worklog/SKILL.md); resolving a rebase does not by itself complete the owning task.
