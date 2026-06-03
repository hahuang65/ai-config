---
name: pickup
description: Resume work from a handoff document written by /handoff. With no argument it picks up the most recent handoff in the OS temp dir; with an argument it finds the matching handoff and confirms before resuming. Use when starting a session that should continue prior handed-off work.
argument-hint: "[handoff slug, topic, or path — leave empty for the most recent]"
---

# Pickup

Resume the work described by a handoff document that `/handoff` wrote to `/tmp/`. This is the read side of the handoff split: `/handoff` writes the routing slip; `/pickup` reads it and starts the work.

## Locating Handoffs

Handoffs live in **`/tmp/`** as `handoff-<slug>-<YYYYMMDD-HHMM>.md`. List them newest-first with this exact command — no shell variables, no other directories:

```bash
ls -t /tmp/handoff-*.md 2>/dev/null
```

- `2>/dev/null` swallows the "no matches" error when none exist.
- Newest-first.
- Never use `$TMPDIR` or any other shell variable — Claude Code's "Contains expansion" safety gate forces a permission prompt for any command containing `$VAR` / `${VAR}` / `$(...)` / backticks, even when the surrounding pattern is on the allowlist. `/handoff` hardcodes `/tmp/` for exactly this reason.

Pull the purpose line from any candidate with `grep -m1 '^# Handoff:' <absolute-path>` — again, no shell variables, using the absolute path from the listing.

**If no handoff documents exist**, tell the user:

> No handoff documents found in `/tmp/`. Run `/handoff <brief>` to create one.

Then stop. Do not invent work.

## Selecting the Document

### No argument → most recent

Take the **first entry** from the listing (the newest handoff) and assume it — no list, no prompt. There's no ambiguity, so don't ask the user to choose. Proceed straight to **Resuming** (restating the purpose as you begin lets the user redirect if it's somehow the wrong one).

### Argument given → match, then confirm

`$ARGUMENTS` is a hint at *which* handoff to resume — a slug fragment, a topic, or a path. Resolve it:

1. **A path to an existing `.md` file** (absolute or relative) → use that file directly.
2. **Otherwise**, treat the argument as a fragment and match it (case-insensitive substring) against the candidates' **filenames** and their `# Handoff:` **purpose lines**:
   - **Exactly one match** → that's the candidate.
   - **Several matches** → present them as a numbered list (filename + purpose + relative mtime) and ask which one.
   - **No match** → say so, show the available handoffs, and ask the user to pick or refine.

**Always confirm with the user before resuming when an argument was given** — fragment matching is fuzzy. Show the resolved document's filename and its purpose line and wait for confirmation before reading it in full and starting work.

## Resuming

Once the document is selected (and confirmed, if an argument was given):

1. **Read it in full.**
2. **Briefly restate** the purpose and any suggested skills so the user can confirm the routing.
3. **Invoke the first suggested skill** (if the handoff names one); otherwise begin executing on the purpose directly.
4. Treat pointer paths (PRDs, tasks files, ADRs, diffs) as the next things to read once work begins.

**Do not delete the handoff file** after picking it up — the user may want to re-read it or hand off again. It lives in `/tmp/`; the OS cleans it up on its own schedule.
