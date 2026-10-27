# Worklog

Worklog is a local, short-term reminder list and work history shared across projects.
Agents call it `worklog`; `wl` is the shell shortcut.
Its default store is `~/.worklog/`, independent of where its source or invoking project lives.
It is not a long-term backlog or a durable job queue.

## Terms

**Project** is the Git repository associated with work.
Its worktrees share the same identity and a readable name.
A named project takes precedence over the current project; otherwise, the current project is the default for explicit subcommands.
The no-subcommand overview instead lists incomplete tasks across all projects, including unassigned work.
Unknown or ambiguous project names require clarification rather than guessed association.

**Task** is a piece of work that can be noted for later, started, completed, or abandoned.
A discussion may advance a task without starting its implementation.
A session or worktree is not a task, and its closure does not establish task completion.

**Reminder** is an unstarted task captured from a clear intention to do something later.
Reminders normally concern today or tomorrow, but do not expire automatically.
Long-term tracking belongs in Jira or GitHub.
An unassigned reminder is allowed only when explicitly requested.

**Entry** is an immutable record of a reminder, task start, meaningful progress, commit, completion, abandonment, or factual correction.
The current task list is derived from the entry history, not maintained by editing past entries.

**Meaningful progress** is a useful advancement of a task or project, including planning or design work before implementation.
It is recorded as a short summary, not an entry for every question, decision, blocker, or tool call.

**Completion** means the intended task outcome has been achieved.
A successful commit is recorded without implying completion.
When a commit also finishes the task, one completion entry includes the commit hash and subject.

**Correction** is a new entry correcting an earlier fact while retaining the original entry.
The corrected interpretation appears in current lists and summaries; the original remains in history.

## Suggestions

After a task is completed, suggest the oldest unstarted reminder belonging to the current project.
Do not suggest another project's work or an unassigned reminder in this project-specific flow.
Do not start the suggested task without the user's approval.
