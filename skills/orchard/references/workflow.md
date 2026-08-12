# Orchard workflow

## Preflight

Before any Orchard operation, run `command -v orchard` and verify that `orchard status --json` returns `protocolVersion: 1`.
If the executable is absent, stop and tell the user to run `~/.dotfiles/git/install.sh`.
If its protocol is incompatible, stop and report the installed and supported versions.
Standalone Orchard operations fail closed; never substitute raw worktree, rebase, integration, or publication commands.

## Command ownership

Pass the user's lifecycle request to the CLI without reproducing its Git, commit-interaction, delivery policy, or filesystem behavior.
Rebase and deliver infer the current task inside its worktree or accept a worktree intent when invoked from primary trunk.
A harness-owned rebase may explicitly request conflict preservation in machine mode, consume its durable `needs-conflict-resolution` outcome, and finalize only the exact recorded operation after the conflict workflow completes.
Default standalone rebases still abort and restore conflicts.
Use ordinary human output only when no harness transition is needed.
A deliver `needs-commit` outcome is non-transitioning; continue the calling workflow in the same turn so it can run the commit skill and retry.
A pull-request delivery is terminal and requires no transition.
Use `--json` for native harness transitions and require an absolute target path in the versioned outcome.

The Orchard workflow has no knowledge of build phases or approval gates.
Its continuation instruction describes only the caller's requested workflow, such as “Continue the workflow that requested this transition.”

## Pi transition

Call the `orchard_transition` tool and inspect its outcome.
When it reports a non-transition outcome such as `needs-commit`, continue the calling workflow in the same turn.
Only a queued worktree transition ends the current turn.
For a queued transition, pass the Orchard command, its arguments, and a generic continuation instruction, then use the tool call as the final action.
The extension invokes the CLI, requires an empty editor, and prefills one authenticated internal command without starting another model turn.
Tell the user to Press Enter once; they never type or copy command text.
Pi then forks persisted history into the target cwd and switches the same TUI session.
If the user declines the prefilled command, the worktree remains preserved for later entry.
Do not send another model response after the tool queues the switch.

## Claude Code transition

Invoke the CLI with `--json`, validate `protocolVersion`, and read the absolute transition target.
Before entering, claim the selected task for the live Claude process through `orchard enter <intent> --json` and retain its exact owner token.
Run that command by itself, with no `--owner-pid` option and no shell variables; the CLI records the calling harness process automatically.
For an `enter` request, use that same owner-claiming command as the initial machine command; after `new` or `convert`, make the owner-claiming `enter` call before switching.
Then call Claude Code's native `EnterWorktree({ path })` with the existing target.
For a local delivery return, let Orchard synchronize, rebase, and fast-forward trunk first, then call `ExitWorktree({ action: "keep" })` to restore the original main project directory without allowing Claude Code to remove the Orchard-owned worktree.
Verify that the current directory matches the CLI-provided return target, release the retained claim through `orchard enter <intent> --release-owner <token> --json`, and only then finalize the CLI-provided cleanup operation using Orchard's internal `--finalize-operation` identifier.
A person uses `orchard deliver --finalize <intent>` instead; never ask the user to copy or type an operation ID.
Never use `EnterWorktree` with the main project directory; Claude Code rejects a primary checkout as an entry target.
Do not implement the transition with a cwd side effect.

If native transition is unavailable, cancelled, or fails, report its preserved path and stop.
Do not create handoff artifacts, open a replacement terminal, or launch another agent.
Never clean the preserved worktree merely because continuation failed.

## Non-transition commands

Status, rebase, path-only output, dry runs, explicit keep behavior, pull-request delivery, needs-commit delivery, and maintenance commands may complete without a harness transition.
If a preserved rebase conflict belongs to a different managed worktree, enter that worktree through the native harness transition before loading the conflict resolver.
Local delivery invoked from primary trunk finalizes immediately when safe.
Delivery outside a managed task worktree or without an explicit worktree intent from primary trunk must fail through Orchard rather than falling back to raw Git commands.
