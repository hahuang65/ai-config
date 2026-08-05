---
description: Git commit and branch-integration conventions — message format, staging, rebasing, and the A5 project exception. Read before any git add, git commit, or branch integration.
---

# Git Commit

Policy for staging and committing. Destructive-command blockers (force-push, `--no-verify`, hard reset) live in `no-git-destructive.md`; this file is about *what a normal commit should contain and how its message should read*.

## Commit message format

**Authoritative source: `@~/.gitmessage`.** Before writing a commit message, read that file and follow its template exactly — it defines the section order (subject, body, annotations), the allowed `TYPE` set, and the formatting rules. If the file does not exist, fall back to the summary below.

Fallback summary (used only when `~/.gitmessage` is absent):

- Subject line: `TYPE: imperative-mood description`, capitalized, no trailing period, ≤ 72 chars.
- Blank line, then a body that answers *what* this change is and *why* it is being made.
- Blank line, then links to issue-tracker tickets or helpful articles, one URL per line, with no section header. If there are no links, omit this section entirely.
- Allowed types: `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, `CHORE`.
- Use the body to explain what and why, not how. Bullets with `-` are fine.
- NEVER auto-add the agent name as a co-author.

## Branch integration

- Rebase local feature branches onto the current target branch before integration.
- Never create merge commits.
- Advance the target branch by fast-forward only.
- If a rebase fails, abort it and preserve both branches unless the user explicitly asks to resolve the conflicts.

### Conflict resolution

- Mutate an in-progress conflict only when the user explicitly asks to resolve it, including by invoking `/resolve-conflicts`, or when the active user-requested workflow already owns conflict resolution.
- Once resolution is explicit, follow the `resolve-conflicts` skill instead of aborting as a substitute for investigating the competing intents.
- Preserve the no-merge-commit policy.
  If an in-progress merge can finish only by creating a merge commit, report that incompatibility before changing conflicted files.
- Before staging resolved paths or continuing a Git operation, apply this rule's normal staging and commit-message policy.
- A workflow-owned working-state restoration conflict does not authorize a commit or rebase continuation.
  Return its resolved paths to the owning workflow so it can reconstruct and verify the captured staged, unstaged, and untracked state.

## Staging policy

- Commit early and often. Small, focused commits are easier to review and revert.
- Each commit should be a single logical change. Don't mix refactoring with feature work.
- Never commit secrets, credentials, or `.env` files.
- When committing changes, always check for corresponding files in `docs/features/` (research documents, plans, architecture diagrams) that were created or modified as part of the work. Include them in the commit unless they are ignored by any git mechanism (`.gitignore`, `.git/info/exclude`, or `core.excludesFile`). These artifacts are part of the feature's history.

### A5 project exception

For any A5 project identified by the harness baseline:

- NEVER explicitly stage `CONTEXT.md`, `docs/adr/**`, or `docs/features/**`, even by exact path. Explicit `git add <path>` bypasses excludes — the directive is what stops the agent from working around the git layer.
- NEVER propose adding these to a tracked `.gitignore`; teammates have not opted in.
- If `git status` lists them as untracked, leave them untracked.
- They are already excluded by the A5-specific global Git configuration. The Git layer is the safety net; this rule is the agent-side enforcement.
