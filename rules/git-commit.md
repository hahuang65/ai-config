---
description: Git commit conventions — message format, branching, what to stage, and the ~/Projects/a5 staging exception. Read before any git add or git commit.
---

# Git Commit

Always-on policy for staging and committing. Destructive-command blockers (force-push, `--no-verify`, hard reset) live in `no-git-destructive.md`; this file is about *what a normal commit should contain and how its message should read*.

## Commit message format

**Authoritative source: `@~/.gitmessage`.** Before writing a commit message, read that file and follow its template exactly — it defines the section order (subject, body, annotations), the allowed `TYPE` set, and the formatting rules. If the file does not exist, fall back to the summary below.

Fallback summary (used only when `~/.gitmessage` is absent):

- Subject line: `TYPE: imperative-mood description`, capitalized, no trailing period, ≤ 72 chars.
- Blank line, then a body that answers *what* this change is and *why* it is being made.
- Blank line, then an annotations block with links to issue-tracker tickets and any helpful articles.
- Allowed types: `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, `CHORE`.
- Use the body to explain what and why, not how. Bullets with `-` are fine.

## Branching

- Work on feature branches, not main
- Branch names: `type/short-description` (e.g., `feature/cursor-pagination`, `fix/auth-redirect`)

## Staging policy

- Commit early and often. Small, focused commits are easier to review and revert.
- Each commit should be a single logical change. Don't mix refactoring with feature work.
- Never commit secrets, credentials, or `.env` files.
- When committing changes, always check for corresponding files in `docs/features/` (research documents, plans, architecture diagrams) that were created or modified as part of the work. Include them in the commit unless they are ignored by any git mechanism (`.gitignore`, `.git/info/exclude`, or `core.excludesFile`). These artifacts are part of the feature's history.

### Exception: ~/Projects/a5/**

For any repo whose working tree lives under `~/Projects/a5/`:

- NEVER explicitly stage `CONTEXT.md`, `docs/adr/**`, or `docs/features/**`, even by exact path. Explicit `git add <path>` bypasses excludes — the directive is what stops the agent from working around the git layer.
- NEVER propose adding these to a tracked `.gitignore`; teammates have not opted in.
- If `git status` lists them as untracked, leave them untracked.
- They are already excluded by `~/.config/git/a5.gitignore`, loaded via an `includeIf "gitdir:~/Projects/a5/"` rule in `~/.gitconfig`. The git layer is the safety net; this rule is the agent-side enforcement.
