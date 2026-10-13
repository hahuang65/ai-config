---
name: handoff
description: Write a selective, private handoff outside the repository so another conversation can resume a specific purpose from verified sources and explicit scope.
---

# Handoff

Write a selective routing summary for the next conversation, not a transcript or durable source of truth.
Confirm the next purpose if it is unclear.
Read [the shared handoff format](references/format.md) and use its metadata so [pickup](../pickup/SKILL.md) can match the current project safely.

1. Inspect current Git identity, branch, HEAD, and uncommitted changes without switching or changing them.
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
5. Tell the user its absolute path, purpose, and suggested next step.
   They can request pickup with that path or use `/skill:pickup` in the same project.

Do not launch a session, change worktrees, automatically invoke another skill, or continue the handed-off work by implication.
Do not delete handoffs or clean up source files.
The temp file is disposable and may disappear; durable knowledge belongs in the referenced project documents.
If this handoff pauses active work, record that meaningful checkpoint through [work-log](../work-log/SKILL.md), including the next action.
Do not mark continuing or unrelated work paused, and do not maintain another Work log store.
