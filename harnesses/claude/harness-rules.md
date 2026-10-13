# Claude Code shell commands

Read this rule before running a shell command in an ordinary Claude Code session.
Claude Code matches permissions against literal command text.
A command that cannot be statically analyzed may stop at a permission prompt.

- Do not use `git -C` by default.
  Change to the repository directory and run a plain Git command so the permission rule can match it.
  Use `git -C <absolute-repository-path>` only when a guard requires it for a cross-repository branch change.
- Do not embed shell variables such as `$?` or `$PPID` in a command.
  Run checks separately or chain commands with `&&`; the harness reports each command's exit code.
