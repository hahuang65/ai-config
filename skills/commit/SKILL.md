---
name: commit
description: Create one focused Git commit with the user's message template and staging policy. Use only when asked to commit, stage and commit, or prepare a commit message.
argument-hint: [scope-or-instructions]
---

# Commit

Commit only when the user explicitly requests a commit.
Preparing a message or staging files alone does not authorize a commit.

Before staging or preparing a message, read the `git-commit.md` rule resolved from the absolute global instruction symlink target as the baseline instructs, and read `~/.gitmessage` if it exists.
Use the rule's fallback format only if the template is absent.
Do not resolve rules against the current project or the old configuration source.

Use the current checkout; do not change worktrees or accept an arbitrary checkout path.

1. Run `git status --short --branch`, `git diff`, and `git diff --cached` in the current checkout.
   Respect any explicit scope and pre-existing staged work.
2. Choose one logical change.
   If unrelated changes or ambiguous scope remain, ask which change to commit.
3. Stage only the selected paths under the resolved Git rule, including its A5 exception.
   Inspect the staged diff and run relevant focused checks.
   Always run the required project checks for each commit; never bypass or suppress a hook.
   A known normal pre-commit hook may supply the checks it covers; run required checks it does not cover explicitly.
   Never use earlier verification to skip this commit's checks, and do not run the same full gate twice just because a known hook will run it.
   Stop on a failed or unavailable required check.
4. Prepare a temporary message file from the user's template.
   Explain what changed and why, and omit an empty links section.
5. Show the staged-file summary and the message.
   Run `git commit -F <message-file>` only if the user explicitly requested a commit, the staged scope is unambiguous, and required checks not supplied by its hook passed; otherwise ask before committing.
   The normal hook must finish its remaining checks successfully before Git creates the commit.
6. Verify the commit and remaining working state.
   Record the exact verified commit and checkout, commands, successful results, and relevant configuration/toolchain state for possible delivery reuse.
   Commit success alone is not proof that required checks ran or that their tested working source matched the committed source.
   If uncommitted changes or unknown hook behavior prevent that proof, report verification as uncertain rather than reusable.
   For active work, use `worklog list --state open --all --json` from the current checkout to find one strong matching task in its project; the default list omits open tasks after the first 20.
   If there is one match, use `worklog commit --task <id> --hash <hash> --subject <subject> --json` to record the commit without completing the task.
   If the full list is too large to inspect safely, report that the checkpoint is unverified; do not guess a task ID, switch stores, or write to a different project.
   If recording fails, report it; never repeat or undo a successful commit to repair the log.

A commit does not by itself complete the work item.
This skill never changes branches, rebases, merges, pushes, or selects a follow-on workflow.
Stop rather than invent scope, force a commit, amend, reset, or override a policy conflict.
