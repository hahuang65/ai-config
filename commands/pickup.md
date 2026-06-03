---
description: Resume work from a handoff document — most recent by default, or the one matching an argument
---
Load the pickup skill, then resume from a handoff document in the OS temp dir.

List handoffs newest-first with the exact, expansion-free command `ls -t /tmp/handoff-*.md 2>/dev/null` (never use `$TMPDIR` or any shell variable). If none exist, tell the user to run `/handoff <brief>` and stop.

**If `$ARGUMENTS` is empty:** assume the most recent handoff (the first entry). Don't make the user choose — read it in full, restate its purpose and suggested skills so they can redirect, then begin.

**If `$ARGUMENTS` is non-empty:** treat it as a hint — a path to an existing `.md` file, or a fragment to match (case-insensitive) against handoff filenames and their `# Handoff:` purpose lines. One match → that candidate; several → present a numbered list and ask; none → show what's available and ask. **Always confirm the resolved document with the user before resuming**, since fragment matching is fuzzy.

Once selected (and confirmed when an argument was given), read it in full, restate the purpose and suggested skills, invoke the first suggested skill if there is one, and treat pointer paths as the next things to read. Do NOT delete the handoff file.
