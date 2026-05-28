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

Plus the always-on git rules this file enforces:

## Commit message format

Follow the template at `~/.gitmessage`:

```
TYPE: Subject line in imperative mood

What is this change?

Why is the change being made?

Link(s) to issue tracker ticket(s)
```

**Types**: `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, `CHORE`

**Rules**:
- Capitalize the subject line
- Limit lines to 72 characters
- Use imperative mood ("Add feature" not "Added feature")
- Do not end the subject line with a period
- Separate subject from body with a blank line
- Use the body to explain what and why, not how

## Branching

- Work on feature branches, not main
- Branch names: `type/short-description` (e.g., `feature/cursor-pagination`, `fix/auth-redirect`)

## Committing docs/claude files

When committing changes, always check for corresponding files in `docs/claude/` (research documents, plans, architecture diagrams) that were created or modified as part of the work. Include them in the commit unless `docs/claude/` is in `.gitignore`. These artifacts are part of the feature's history.

## General

- Commit early and often. Small, focused commits are easier to review and revert.
- Each commit should be a single logical change. Don't mix refactoring with feature work.
- Never force-push to shared branches.
- Never commit secrets, credentials, or `.env` files.

Re-plan the operation as a hand-off to the user, then proceed.
