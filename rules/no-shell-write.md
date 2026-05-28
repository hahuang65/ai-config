---
description: Block writing files via shell redirection — use Write/Edit tools instead so per-file approval applies.
condition:
  - '\becho\s+[^|]*\s*>>?\s*[^\s|&]'
  - '\bprintf\s+[^|]*\s*>>?\s*[^\s|&]'
  - '\bcat\s*>\s*\S'
  - '\btee\s+[^-]\S+'
scope: tool:bash
---

# No shell-redirect file writes

You were about to write to a file via shell redirection (`echo >`, `cat >`, `tee`). Stop.

Shell-redirected writes bypass the per-file approval the `Write` and `Edit` tools provide. The user can't see what's about to be written before it lands on disk.

Right approach:

- Use the `Write` tool for new files
- Use the `Edit` tool for in-place changes to existing files
- Reserve `echo >` / `cat >` for content the user explicitly asked to be written via shell (rare)

Re-plan the file mutation through `Write` or `Edit`, then proceed.
