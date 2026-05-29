---
description: Block force-push, hook-skip flags, and history-destroying resets.
condition:
  - 'git\s+push\b[^|;&\n]*\s(--force\b|--force-with-lease\b|-f\b)'
  - 'git\s+push\s+(--force\b|--force-with-lease\b|-f\b)'
  - '--no-verify\b'
  - '--no-gpg-sign\b'
  - 'git\s+commit\s+--amend\s+[^|;&\n]*--no-edit'
  - 'git\s+reset\s+--hard\s+\S'
  - 'git\s+clean\s+-[a-z]*f\b'
scope: tool:bash
---

# Git Workflow

You were about to run a git command that destroys history, rewrites shared branches, or bypasses safety hooks. Stop and confirm with the user.

Common triggers and the fix:

- **`git push --force` / `--force-with-lease` / `-f`** → Force-push to shared branches is forbidden. If you genuinely need to rewrite a personal feature branch, ask the user to do it manually with explicit confirmation.
- **`--no-verify` / `--no-gpg-sign`** → These bypass pre-commit hooks and signing. The hooks exist for a reason — fix the underlying failure instead of skipping the check.
- **`git commit --amend --no-edit`** on a likely-pushed commit → Amending a commit that's already on a remote rewrites shared history. Create a new commit instead.
- **`git reset --hard <ref>`** → Destroys uncommitted work and rewinds the branch. If you need to discard changes, do it interactively with the user, not autonomously.
- **`git clean -f`** → Permanently deletes untracked files. Same caution as `reset --hard`.

Re-plan the operation as a hand-off to the user, then proceed.
