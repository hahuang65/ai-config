# Claude Code Harness Rules

These rules apply only in the Claude Code harness.
They exist because Claude Code approves shell commands by matching permission rules against literal command text.
A command that cannot be statically analyzed skips the allow rules and stops the session at a permission prompt.

## Compose statically analyzable commands

- Do not use `git -C`.
  Change into the repository with `cd` and run plain `git` subcommands, so permission rules can match them.
  Exception: use `git -C <absolute-repository-path>` when a guard requires it for a cross-repository branch change.
- Do not embed shell variables such as `$?` or `$PPID` in commands.
  A variable expansion makes a command statically unanalyzable, so no permission rule can match it.
  The harness already reports each command's exit code; run probes as separate commands or chain them with `&&`.
