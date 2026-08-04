# Use hybrid pooled branch-bound worktrees

The worktree manager gives each repository a project group beneath `~/.orchard/`, with readable active task directories by intent and detached available slots under that group's hidden `.pool/` directory.
A project group normally uses the project basename; if that name is already owned by another repository, the new group prepends its main project directory's parent name while the existing group remains unchanged.
Moving a slot between active and available paths preserves dependencies and caches without exposing pool machinery as task names.
Ordinary work defaults to a local task branch and uses a worktree only when explicitly requested; `/build` uses a linked worktree whenever a compatible Orchard executable is available, and a local task branch can be converted later without changing its branch identity.
Use one concise short intent for task identity: local branches name it `user-initials/<short-intent>`, while Orchard receives the same `<short-intent>` and supplies the enclosing project group.
Conversion is a locked, recoverable transaction that preserves staged, unstaged, and untracked work through uniquely identified temporary state, while ignored files stay in their original working directory.
Orchard owns the worktree transition after creating, converting, or selecting a task worktree: its harness adapters continue the current visible interaction through native worktree or session-switching capabilities, while its terminal surface enters through a shell.
Claude Code records a live process ownership claim, enters through its native existing-worktree operation, returns through its native exit operation with keep behavior, and releases the exact claim after restoring the original main directory without allowing Claude Code to remove an Orchard-owned worktree.
Pi restricts session replacement to a user-submitted extension command, so its adapter stores a one-time authenticated request, preloads that command only into an empty editor, terminates the initiating model turn, and requires one Enter keypress before forking persisted history and switching the same TUI session.
The user never types or copies command text, and no additional model turn runs before the transition.
A draft already present in the editor is never overwritten; declined confirmation, token replay, or transition failure preserves the task worktree and ownership for safe recovery.
The `/build` orchestrator continues uninterrupted inside any existing linked worktree without requiring Orchard, but delegates acquisition and transition to Orchard when started outside one and executable preflight succeeds.
If the executable is missing or protocol-incompatible before acquisition, `/build` warns that isolation and Orchard merge support will be unavailable and asks whether to continue through the ordinary local-task-branch workflow.
That degraded mode is never automatic, does not duplicate worktree lifecycle logic, and remains subject to the build pipeline's four approval gates.
Declining the fallback stops with Git dotfiles installation guidance.
Acquisition or native-transition failure after Orchard mutates state preserves the task worktree and stops without offering branch fallback.
Standalone Orchard and `deliver` workflows fail closed when the executable is unavailable or incompatible.
Orchard never adopts or relocates an unmanaged worktree and contains no build-phase knowledge.
This native continuation avoids conversion handoff files, `/pickup` coupling, user-started replacement sessions, terminal-backend orchestration, and a maintained pi fork.
Dirty or unmerged task worktrees are never recycled.
Lifecycle ownership is daemonless but durable: state changes are atomically locked, live processes are detected on macOS and Linux, and damaged state is reconstructed conservatively with uncertain worktrees quarantined rather than reused.
Destruction is preview-only by default and gates unlanded work, live processes, unverifiable state, and branch deletion behind independent explicit flags; bulk operations never cross a named project group.
The Orchard executable, lifecycle service, runtime modules, CLI tests, and command installation are baseline Git tooling owned by the Git dotfiles repository.
The AI dotfiles repository owns only Orchard workflow skills, build and commit policy, and native Claude Code and pi transition adapters.
AI integrations invoke the installed executable through a versioned structured protocol and never import, vendor, or reimplement its Git lifecycle behavior.
The Git dotfiles installer exposes the executable at `~/.local/bin/orchard`; the AI installer does not install it.
The tool has no configuration files: it trusts user-level `git new` and `git sync` aliases when present, verifies their postconditions, and never executes repository-local shell aliases.
Without those global aliases it uses ordinary unprefixed branch creation and explicit fast-forward synchronization; optional per-project pool capacity comes from `ORCHARD_MAX_TREES` with a default of four.
A successful merge runs from the main project directory, rebases the clean task branch onto synchronized trunk, and then advances trunk to the rebased feature tip by fast-forward only.
This deliberately rewrites only the unlanded local task commits and never creates a merge commit or pushes.
If the rebase conflicts or otherwise fails, Orchard automatically aborts it, verifies restoration of the original task tip, and leaves trunk, both checkouts, and the caller's location unchanged.
After proving the branch landed on trunk, the default merge flow transitions the current caller back to the main project directory before recycling the worktree and removing the merged local branch.
Pi uses the same prefilled one-Enter confirmation for this return, and cleanup cannot begin until the privileged command has switched the current interaction to the main directory.
If that return transition fails, the trunk advance remains valid while the landed task worktree and branch stay intact for later recycling; the manager never removes a worktree still occupied by its caller.
An explicit keep option skips both the return transition and automatic cleanup.
The harness-neutral `deliver` skill owns one explicit commit-if-needed and delivery workflow.
It reuses the checkout-local `commit` skill for a dirty task, then forwards ordinary-project integration to Orchard or opens the A5 pull-request flow after Orchard rebasing.
For an A5 branch, delivery resolves the pull-request target remote through read-only metadata, checks both the configured upstream and a same-named remote head, and stops when publication status is ambiguous.
It records any published tip before rebasing and stops for user direction if rewriting makes that tip no longer ancestral, because neither an implicit non-fast-forward publication nor a force-push is permitted.
It never implements Git integration independently, falls back to raw `git merge`, or pushes, and it refuses outside a managed task worktree rather than guessing at a target.
The `commit` skill remains independently usable and checkout-local: it may inspect state, stage the selected change, and create one commit, but never invokes Orchard, changes worktree or branch lifecycle, merges, rebases, pushes, or selects a follow-on action.
A standalone commit still requires a separate explicit delivery action.
Remote landing detection checks Git ancestry first and consults read-only GitHub PR metadata only when ancestry cannot prove an exact-tip squash or rebase merge.
This combines Orchard-style environment reuse with ordinary Git branch recoverability and avoids the orphaned-commit risk of a purely detached pool.
