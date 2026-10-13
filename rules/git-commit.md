---
description: Read before staging, preparing a commit message, committing, pushing, or integrating.
---

# Git commit and integration

Stage, commit, push, or deliver only when the current user request explicitly owns that action.
Never branch, stage, or commit in the `~/.dotfiles` parent repository, which stays on `main`.
Apply the named task-branch rule independently in each affected submodule.
Never stage credentials, secrets, `.env` files, or private configuration.

## Message and scope

Before preparing a commit message, read `~/.gitmessage` and use its exact section order, allowed types, and formatting.
If that file is absent, use an imperative, capitalized `TYPE: description` subject of at most 72 characters with no trailing period.
The fallback types are `FEATURE`, `FIX`, `REFACTOR`, `STYLE`, `DOCS`, `TEST`, and `CHORE`.
Leave a blank line before the body, which explains what changed and why.
Put optional issue or reference URLs on separate lines without a section heading.
Do not add an AI coauthor.

Inspect the current branch, staged and unstaged diffs, and relevant untracked files.
Choose one logical change and prefer explicit paths when staging.
Do not use `git add .` unless the user explicitly asks for every changed file and the inspected status shows that it is safe.
Inspect the final staged diff before committing, and do not bypass checks with `--no-verify`.
In ordinary projects, include related, non-ignored context files, `docs/adr/**`, and intentional `docs/features/**` artifacts in the focused commit.
Do not infer ownership over unrelated or already staged work.

## A5 staging exception

A project is A5 only when its originating repository has effective `ai.projectFamily=a5` from global or system Git configuration.
Repository-local configuration cannot grant A5 status.
In an A5 project, never explicitly stage `CONTEXT.md`, `docs/adr/**`, or `docs/features/**`, even by exact path.
Do not add these paths to a tracked `.gitignore`; leave them untracked where appropriate.
Never force-add a linked worktree's ignored root `domain-documentation.json`.
Confluence context and decisions documents have no local companions to stage.

## Integration and conflict boundaries

Rebase a task branch on its current target branch and integrate by fast-forward only; never create a merge commit.
A failed ordinary rebase must preserve both branches unless the user explicitly authorized conflict resolution.
Resolve an in-progress conflict only under an explicit user request or an active workflow that already owns that resolution.
Follow the conflict-resolution skill before staging resolved paths or continuing an operation.
A working-state restoration conflict does not authorize a commit or rebase continuation.
Never force-push, hard-reset, or amend as a workaround for a failed operation.
