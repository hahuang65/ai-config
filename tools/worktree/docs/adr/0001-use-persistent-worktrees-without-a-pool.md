# Use one persistent Git worktree per task

The user often runs two to four agent tasks in one project and may return to an unfinished task weeks later.
A worktree pool made starting isolated work feel heavy enough that tasks sometimes began in the main checkout instead.

Create worktrees on demand and discover them through Git, without a pool, background monitor, or expiry policy.
Show existing tasks during creation and provide explicit cleanup, so forgotten tasks remain visible without risking unfinished work.
Keep delivery outside WT and session replacement in a small Pi adapter; this loses prepared dependency reuse but avoids coupling Git cleanup to the entire development workflow.
