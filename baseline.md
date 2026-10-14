# Shared global instructions

These instructions apply to ordinary agent sessions.
Keep normal user and project resource discovery enabled.
Restricted reviewers use separate, explicitly isolated runners.

## Work safely

Use a named task branch (`user-initials/short-intent`), never trunk.
Before adding, editing, or removing repository files, inspect the repository, checkout, branch, and working state; load `skills/worktree/SKILL.md` from this instruction file's absolute source.
Reuse an existing verified task worktree; otherwise create or enter a managed task worktree for a user-requested edit without asking again when the primary checkout is clean.
Do not edit until the current session is running in that worktree; if transition is unavailable or the checkout has unrelated changes, stop and ask rather than moving, stashing, or copying changes.
Only a single self-contained change may skip the worktree when the user explicitly chooses direct-checkout work and grants commit authorization up front; still use a named task branch and never treat that exception as permission to stage or commit unrelated changes.
Keep the `~/.dotfiles` parent repository on `main`; do not branch, stage, commit, or make a worktree there.
Use a task branch independently in each affected submodule.
Do not stage, commit, push, or deliver unless the current request explicitly authorizes that action.
Never clean a worktree merely because work ends.
An explicit delivery request includes safe cleanup after proven local integration and a verified native session return to the primary directory; otherwise cleanup requires an explicit request.
Do not change the installed AI configuration while testing a replacement package.
Use mise-managed tools directly by name; do not activate another version manager.
Keep TypeSafe and Herdr independently configured.

## Communicate clearly

Use the project's documented terms consistently and define unfamiliar terms when needed.
Lead with the answer and state what was verified and what remains uncertain.
Use plain language and put each complete Markdown sentence on its own line.
Treat approval as approval of the stated artifact or action, not unrelated work.

## Load rules when needed

The following advisory rules belong to this replacement package, not to another configuration source.
To find a rule, read the absolute symlink target of the current harness's global instruction file (`~/.claude/CLAUDE.md` or `~/.pi/agent/AGENTS.md`).
Use the directory containing that target as the base, then append `rules/<name>.md`.
For example, if the target is `/path/to/source/baseline.md`, read `/path/to/source/rules/testing.md` before writing tests.
Do not resolve a rule relative to the current project directory.
Read only the relevant rules before the action:

- `a5.md`: A5 classification, service authentication, credential renewal, or development containers.
- `cli-ergonomics.md`: designing, implementing, or reviewing an agent-facing CLI.
- `coding-style.md`: writing or modifying source code.
- `documentation.md`: changing context documentation or durable decisions.
- `git-commit.md`: staging, preparing commits, committing, pushing, or integrating.
- `html-routing.md`: opening or presenting an HTML file.
- `mise.md`: invoking language or package-manager tools.
- `performance.md`: optimizing, caching, bounded retrieval, or external calls.
- `security.md`: external input, SQL, shells, file paths, rendering, authorization, or logging.
- `testing.md`: test strategy or writing and modifying tests.

In Claude Code only, read the shell guidance before a shell command.
From the directory containing the global instruction symlink target, use `harnesses/claude/harness-rules.md` (`/path/to/source/harnesses/claude/harness-rules.md`).
Do not resolve it relative to the current project directory.

A project is A5 only if its originating repository has effective `ai.projectFamily=a5` from global or system Git configuration.
Repository-local configuration cannot grant A5 status.
