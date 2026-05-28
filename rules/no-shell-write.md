---
description: Block writing files via shell redirection — use Write/Edit tools instead so per-file approval applies.
condition:
  - '\becho\s+[^;&|<>\n]*>>?\s*(?!/dev/(?:null|stderr|stdout|fd)\b|&\d)[^\s|&>]'
  - '\bprintf\s+[^;&|<>\n]*>>?\s*(?!/dev/(?:null|stderr|stdout|fd)\b|&\d)[^\s|&>]'
  - '\bcat\b[^;&|\n]*>\s*(?!/dev/(?:null|stderr|stdout|fd)\b|&\d)[^\s|&>]'
  - '\btee\s+(?:-\S+\s+)*(?!/dev/(?:null|stderr|stdout|fd)\b)\S'
scope: tool:bash
---

# No shell-redirect file writes

You were about to write to a file via shell redirection (`echo >`, `cat >`, `tee`).
Stop the offending bash call.

Shell-redirected writes bypass the per-file approval the `Write` and `Edit` tools
provide. The user can't see what's about to be written before it lands on disk.

## Right approach

- Use the `Write` tool for new files
- Use the `Edit` tool for in-place changes to existing files
- Reserve `echo >` / `cat >` for content the user explicitly asked to be written via
  shell (rare)

Re-plan the file mutation through `Write` or `Edit`, then proceed.

## Scope of this block

This rule blocks **one bash call** — the specific command whose stream tripped the
regex. Other planned tool calls in the same turn (reads, edits, writes, other bash
commands that don't write via redirection) are unaffected. Do **not** treat this as
a session-wide gating signal or a reason to start asking permission for everything.

## If you believe this is a false positive

The regex excludes `>/dev/null`, `>/dev/stderr`, `>/dev/stdout`, `>/dev/fd/N`, and
`>&N` (FD redirects like `2>&1`). If your blocked command only used those forms and
no real file path, the trigger was spurious.

In that case:

1. Say so plainly to the user in one sentence: *"The `no-shell-write` rule fired,
   but the command only redirects to `/dev/null` and merges stderr — there's no
   file write here."*
2. Restate the exact blocked command.
3. Propose proceeding (you may re-issue the same command).
4. Do **not** generalize the false positive into self-imposed gates on other
   planned operations.
