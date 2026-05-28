---
description: Block rm -rf of /, $HOME, ~, *, and other broad targets.
condition:
  - '\brm\s+-rf?\s+(/|\$HOME|~)(\s|$)'
  - '\brm\s+-rf?\s+/$'
  - '\brm\s+-rf?\s+\*'
  - '\brm\s+-rf?\s+\.\.?(/|$)'
scope: tool:bash
---

# No broad rm -rf

You were about to delete an extremely broad target with `rm -rf`. Stop.

The patterns this rule catches — `rm -rf /`, `rm -rf $HOME`, `rm -rf ~`, `rm -rf *`, `rm -rf .`, `rm -rf ..` — are either catastrophic (data loss across the system) or wildly imprecise (deletes everything in the current directory or its parent).

Right approach:

- Delete specific named files: `rm path/to/specific/file.txt`
- Delete a specific directory by name: `rm -rf docs/old-feature-prototype`
- Never use a wildcard, a relative-traversal (`.`, `..`), `/`, or `~` as the target

If you genuinely need to clean up a large area, list the files first (`ls`), confirm with the user, and then delete by explicit name.

Re-plan the deletion, then proceed.
