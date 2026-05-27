---
description: Write a handoff doc for another session, or resume from the latest one if called without arguments
---
Load the handoff skill, then choose the mode based on `$ARGUMENTS`.

**If `$ARGUMENTS` is non-empty (Write mode):** Treat it as the brief for the next session. Write the document to the user's OS temp directory (NOT the workspace), in the format described in the skill: purpose of the next session, relevant context, suggested skills, and pointers to existing artifacts (not duplicated content). Redact API keys, passwords, and PII. After writing, tell the user the absolute path. Do NOT continue work on the handed-off task in the current session — that defeats the purpose of the split.

**If `$ARGUMENTS` is empty (Resume mode):** Look in the user's OS temp dir for `handoff-*.md` files. If none exist, tell the user and stop. Otherwise, present the 5 most recent (newest first) with their purpose lines and ask the user which to pick up. Once picked, read it in full, briefly restate the purpose and suggested skills for confirmation, then begin executing — invoking the first suggested skill if there is one.
