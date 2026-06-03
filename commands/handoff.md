---
description: Write a handoff doc to the OS temp dir so another agent session can continue the work
---
Load the handoff skill and write a handoff document for the next session.

Treat `$ARGUMENTS` as the brief for the next session. Write the document to `/tmp/` (NOT the workspace), in the format described in the skill: purpose of the next session, relevant context, suggested skills, and pointers to existing artifacts (not duplicated content). Redact API keys, passwords, and PII. After writing, tell the user the absolute path and that they can resume it with `/pickup`. Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.

To resume a handoff instead of writing one, use `/pickup`.
