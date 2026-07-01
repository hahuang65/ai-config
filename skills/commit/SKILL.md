---
name: commit
description: Create a focused git commit using the repository git-commit rule and the user's ~/.gitmessage template. Use when the user asks to commit, stage and commit, or prepare a commit message.
argument-hint: [scope-or-instructions]
---

# Commit

Create one focused git commit that follows the user's commit-message template and this repo's staging policy.

## Mandatory inputs

Before staging or writing a commit message, read both:

1. `../../rules/git-commit.md` — staging policy, docs/features handling, branch guidance, and the `~/Projects/a5/**` exception.
2. `~/.gitmessage` — authoritative commit-message format. If it is absent, use the fallback format in `rules/git-commit.md`.

Do not rely on memory for the commit format. Do not invent a different format.

## Process

1. **Inspect state**
   - Run `git status --short --branch`.
   - Review `git diff --cached` and `git diff`.
   - If `$ARGUMENTS` specifies a scope, limit the commit to that scope.

2. **Choose one logical change**
   - Commit only one logical change.
   - If the working tree contains multiple unrelated changes, stop and ask which one to commit first.
   - If there are already staged files, treat them as intentional but still verify they form one logical change.

3. **Stage safely**
   - Follow `../../rules/git-commit.md` exactly, including the `docs/features/` policy and the `~/Projects/a5/**` exception.
   - Prefer explicit paths. Do not use broad staging commands like `git add .` unless the user explicitly asked for every changed file and the status confirms that is safe.
   - Never stage secrets, credentials, `.env` files, or files blocked by the rule.

4. **Write the message from `~/.gitmessage`**
   - Build the commit message in a temporary file.
   - Follow the template's section order, allowed `TYPE` set, and formatting rules exactly.
   - The body should explain what changed and why, not narrate implementation steps.
   - For links, put each URL on its own line with no section header. If there are no links, omit the links section entirely.

5. **Commit**
   - Show a concise summary of staged files and the commit message.
   - If the user invoked this skill with an explicit commit request and the staged set is unambiguous, run `git commit -F <temp-message-file>`.
   - Otherwise, ask for confirmation before committing.

## Hard stops

Stop and ask the user instead of committing when:

- Changes span multiple logical commits.
- The requested scope is ambiguous.
- Staging would violate `../../rules/git-commit.md`.
- `~/.gitmessage` is missing and the fallback format is insufficient for the repository.
- The commit would require `--no-verify`, `--amend`, force-push, reset, or other destructive git behavior.
