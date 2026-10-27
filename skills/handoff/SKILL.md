---
name: handoff
description: Write a selective, private handoff outside the repository with separate discovery and implementation projects so another conversation can resume a specific purpose from verified sources and scope.
---

# Handoff

Write a selective routing summary for the next conversation, not a transcript or durable source of truth.
Confirm the next purpose if it is unclear.
Read [the shared handoff format](references/format.md) and use its discovery and implementation metadata so [pickup](../pickup/SKILL.md) can find the handoff from the intended project.

1. Inspect the discovery project's current Git identity, branch, HEAD, and uncommitted changes without switching or changing them.
   Resolve the intended implementation project separately from the user's explicit target, using a verified local checkout and the shared identity procedure.
   Do not infer an implementation project from a repository basename, a remote URL, or the discovery directory.
   If a named target cannot be resolved safely, ask for its path before writing the handoff.
   If no other target was named, use the discovery project for both roles.
   Inspect the named implementation checkout's Git identity and relevant state read-only, without creating or entering a worktree there.
   Include only state relevant to the next purpose; distinguish your work from unrelated changes.
2. Create a uniquely named private `handoff-<random>` directory in the OS temp directory, outside the repository, with owner-only access.
   Write `handoff.md` inside it with owner-only access and exclusive creation.
   Do not reuse or follow an existing directory or file symlink, or overwrite an existing handoff.
3. Fill in the metadata and concise sections from the format.
   Reference authoritative documents; do not duplicate their contents or create a hidden duplicate source.
   Include unresolved questions, exact focused check results, and the next proposed action.
   Separate verified facts, user decisions, and assumptions.
4. Exclude secrets, credentials, private customer data, raw transcripts, and environment dumps.
   Sanitize command examples and URLs, and omit irrelevant history.
   Review the summary for sensitive content before writing it.
5. Tell the user its absolute path, purpose, both project roles, and suggested next step.
   Suggest that they run pickup from the intended implementation project, with that path or `/skill:pickup` there.

Do not launch a session, change worktrees, automatically invoke another skill, or continue the handed-off work by implication.
Do not delete handoffs or clean up source files.
The temp file is disposable and may disappear; durable knowledge belongs in the referenced project documents.
If this handoff pauses active work, record that meaningful checkpoint through [work-log](../work-log/SKILL.md), including the next action.
Do not mark continuing or unrelated work paused, and do not maintain another Work log store.
