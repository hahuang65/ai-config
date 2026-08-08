---
name: resolve-conflicts
description: Resolve an in-progress Git rebase or merge conflict, resume a validated Orchard rebase after its resolutions are staged, or resolve a workflow-owned working-state restoration conflict by recovering both changes' intent. Use when Git reports unresolved entries in a supported context, Orchard records a rebase awaiting continuation, or the user invokes /resolve-conflicts.
argument-hint: "[operation-goal-or-intent]"
---

# Resolve Conflicts

Resolve a supported Git conflict context without inventing behavior or discarding either side's intent silently.

Read [the resolution workflow](references/workflow.md) before changing a conflicted file.
When incompatible hunks remain, also read [the conflict decision review](references/conflict-review.md).

Treat a supplied operation goal or intent as context for recovering the competing changes' intent.
Require unresolved entries from either an in-progress rebase or merge, a validated Orchard rebase recovery whose active operation awaits continuation, or a working-state restoration conflict owned by a trusted active workflow with durable recovery metadata.
Do not accept a user-supplied stash identifier or path as proof of restoration ownership.
If no supported context is active, report the current Git state and stop without starting one.
If completing the active operation would violate an applicable Git policy, report that incompatibility before changing files and wait for user direction.

This skill adapts Matt Pocock's [`resolving-merge-conflicts`](https://github.com/mattpocock/skills/blob/main/skills/engineering/resolving-merge-conflicts/SKILL.md) workflow.
