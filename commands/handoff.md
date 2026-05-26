---
description: Compact the current conversation into a handoff document in the OS temp dir for another agent session to pick up
---
Load the handoff skill, then write a handoff doc: $ARGUMENTS

Follow the handoff skill workflow. Treat `$ARGUMENTS` as the brief for the next session — what it will focus on. Write the document to the user's OS temp directory (NOT the workspace), in the format described in the skill: purpose of the next session, relevant context, suggested skills, and pointers to existing artifacts (not duplicated content). Redact API keys, passwords, and PII. After writing, tell the user the absolute path so they can pass it to a new session.

Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.
