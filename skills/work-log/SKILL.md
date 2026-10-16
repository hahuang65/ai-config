---
name: work-log
description: Capture later-work remarks, record task starts, meaningful progress, commits, completion or abandonment, and recall short-term tasks and work history through worklog.
---

# Work log

Worklog is a short-term reminder list and work history, not a long-term backlog or durable job queue.
Use only the replacement-owned `../../tools/worklog/target/release/wl`, resolved from this skill's absolute source path.
The default store is `~/.worklog/`, shared across projects and source checkouts.
`WL_ROOT` explicitly selects another store for tests or a controlled cutover; never change stores merely because a query is empty.
The shell shortcut is `wl`; agent invocations use `worklog`.
Read its `--help` and the relevant command help; use structured output for automation.
Never use the original `work-log` CLI or edit its data as a fallback.
If worklog is absent or a write fails, report that nothing was recorded; do not claim success or repeatedly retry an unavailable tool.

## Associate the work

Use the project the user names; otherwise use the current Git project.
Repository identity is shared across its worktrees, with a readable name for the user.
Ask if a named project is unknown or ambiguous; do not register a guessed repository or assign another project's reminder to the current one.
Allow an unassigned reminder only when explicitly requested.
Look for a clear existing task before adding one, and ask rather than merging ambiguous matches.

## Record

- Recognize clear later-work remarks without requiring command wording.
  Note the reminder and briefly confirm its project and title without changing the current task.
- Record a task start when work actually starts; discussion alone does not start a queued task.
- Record meaningful progress, including useful planning or design discussions, as one short summary associated with a task or project.
  Do not log every answer, decision, blocker, tool call, or repeated test run.
- Record successful commits with their hash and subject.
  If the same commit completes the task, use one completion entry containing the commit instead of two entries.
- Record completion or abandonment only when that outcome is established.
  A commit, session ending, or worktree cleanup does not establish it by itself.
- A factual correction appends a new entry; never edit or delete history.

Keep records concise and synthesized; exclude secrets, raw transcripts, environment dumps, and private customer data.
Do not infer progress from file activity or create separate entry quotas.
Avoid duplicate entries when one skill calls another for the same outcome.
After recording a checkpoint, return to the caller's next authorized step under the shared bootstrap's [continuation policy](../../baseline.md#keep-work-moving).
A logging failure does not block otherwise authorized work; report the failed record without repeatedly retrying it.

## Recall and suggest

After completing a task, suggest the oldest unstarted reminder in the current project if one exists.
Never start it automatically; exclude other projects and unassigned reminders.
Keep reminders visible until started or abandoned, with no expiry, scheduling, or notifications.
Summarize open work and dated history when asked, using completed and abandoned tasks as history rather than active reminders.
Report a failed or incomplete query rather than treating it as an empty list.
