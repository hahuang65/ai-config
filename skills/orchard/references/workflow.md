# Orchard workflow

## Preflight

Before any Orchard operation, run `command -v orchard` and verify that `orchard status --json` returns `protocolVersion: 1`.
If the executable is absent, stop and tell the user to run `~/.dotfiles/git/install.sh`.
If its protocol is incompatible, stop and report the installed and supported versions.
Standalone Orchard operations fail closed; never substitute raw worktree or merge commands.

## Command ownership

Pass the user's lifecycle request to the CLI without reproducing its Git or filesystem behavior.
Use ordinary human output only when no harness transition is needed.
Use `--json` for native harness transitions and require an absolute target path in the versioned outcome.

The Orchard workflow has no knowledge of build phases or approval gates.
Its continuation instruction describes only the caller's requested workflow, such as “Continue the workflow that requested this transition.”

## Pi transition

Use the `orchard_transition` tool as the final action of the current tool turn.
Pass the Orchard command, its arguments, and a generic continuation instruction.
The extension invokes the CLI, requires an empty editor, and prefills one authenticated internal command without starting another model turn.
Tell the user to Press Enter once; they never type or copy command text.
Pi then forks persisted history into the target cwd and switches the same TUI session.
If the user declines the prefilled command, the worktree remains preserved for later entry.
Do not send another model response before the switch.

## Claude Code transition

Invoke the CLI with `--json`, validate `protocolVersion`, and read the absolute transition target.
Before entering, claim the selected task for the live Claude process through `orchard enter <intent> --owner-pid "$PPID" --json` and retain its exact owner token.
For an `enter` request, include that owner option in the initial machine command; after `new` or `convert`, make the owner-bearing `enter` call before switching.
Then call Claude Code's native `EnterWorktree({ path })` with the existing target.
For default merge return, let Orchard rebase the task and fast-forward trunk first, then call `ExitWorktree({ action: "keep" })` to restore the original main project directory without allowing Claude Code to remove the Orchard-owned worktree.
Verify that the current directory matches the CLI-provided return target, release the retained claim through `orchard enter <intent> --release-owner <token> --json`, and only then finalize the CLI-provided cleanup operation.
Never use `EnterWorktree` with the main project directory; Claude Code rejects a primary checkout as an entry target.
Do not implement the transition with a cwd side effect.

If native transition is unavailable, cancelled, or fails, report its preserved path and stop.
Do not create handoff artifacts, open a replacement terminal, or launch another agent.
Never clean the preserved worktree merely because continuation failed.

## Non-transition commands

Status, rebase, path-only output, dry runs, explicit keep behavior, and maintenance commands may run directly through the executable.
A merge requested outside a managed task worktree must fail through Orchard rather than falling back to raw Git merge or rebase commands.
