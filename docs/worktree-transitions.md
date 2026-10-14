# Native task conversations

WT selects and validates task worktrees.
The installed harness adapter performs the native transition; neither `wt new` nor a child shell `cd` moves a running conversation.
New tasks carry the current conversation.
Existing tasks resume their saved conversation for the current harness, never an arbitrary recent conversation and never a transcript converted from the other harness.

## Pi

Use `/wt new TASK` or `/wt enter TASK` in interactive Pi.
Task names follow WT's 1–64-character contract: ASCII letters, digits, underscores, and hyphens, starting with a letter or digit.
Uppercase names such as `Task_123-xyz` are supported by both the command and the model-facing transition tool.
`/wt new TASK --local` is available only when the user deliberately chooses local history instead of fetching.
The model may call `worktree_transition` to prepare the command in an empty editor.
The user presses Enter once; no worktree is created before that command runs.
An existing editor draft is never replaced.
Until submission, task tool calls are blocked; `/wt cancel` clears the pending transition without changing worktrees.

A new task forks the persisted conversation, preserving its selected branch and compaction entries, then calls Pi's native `switchSession` command API.
That API rebuilds the runtime, tools, project resources, and context for the destination directory with normal discovery and trust behavior.
An existing task uses its exact saved session file instead.
The replacement context confirms the destination directory, selected conversation, task branch, and repository identity before reporting a successful transition.
Ordinary startup and manual session switches do not acquire a task or require a saved conversation binding.
Pi 1.1.0's native session replacement API is required.
Print and RPC modes do not silently substitute a child process.

## Claude Code

For a new task, call native `EnterWorktree` with `name: TASK`.
The owned `WorktreeCreate` hook runs WT and returns its verified path.
Claude moves its own working directory while retaining the current conversation.
Alternatively, after an explicitly requested `wt new TASK`, call `EnterWorktree` with the returned `path`.
The entry hook validates that managed task and checks its saved conversation before Claude enters it.
Claude may request native permission to enter a path outside `.claude/worktrees`; do not bypass it.
The post-entry hook and subsequent tool hooks verify the actual host directory and conversation.

For an existing task, read `wt session inspect TASK --harness claude` using the package-owned executable.
Ask the user to run `/resume SESSION_ID` with its exact `conversation` value.
Claude's native resume restores the saved conversation and worktree binding.
A hook cannot invoke `/resume` on behalf of the interactive host, so do not claim the switch happened until the resumed session verifies its directory and saved conversation.
If Claude resumes outside the recorded task, tools remain blocked rather than continuing in the wrong checkout.

Before starting another task from an existing task conversation, ask the user to run native `/branch` to preserve the original task conversation.
In the fork, use `ExitWorktree` with `action: keep`, then enter the new task.
The original session remains the existing task's saved conversation.
Do not reuse one conversation ID for multiple tasks or overwrite a saved binding.
These APIs were checked against Claude Code 2.1.296.
A sandboxed native-process test uses a loopback-only synthetic provider to verify entry, persisted history, resume, and the actual Bash working directory without live credentials.
Interactive `/branch` and `/resume` UI actions still require a human smoke test.
Native resume restores its worktree before `PreToolUse` verifies the saved conversation's directory.
No startup or shutdown hook tracks a session owner.
A manual conversation that is not a saved task reference is not rejected merely because it uses a task checkout.

## Saved references and recovery

Each task has separate `wt-session-pi.json` and `wt-session-claude.json` references in its Git administrative directory.
Records bind the repository common directory, task path, branch, harness, and conversation reference.
They contain no transcript content.
These references are not exclusive ownership: they do not claim a worktree, track a PID, or lock out manual work or another process.
There are no session claims, reservations, heartbeats, expiry rules, or shutdown releases.
The `session` protocol does not acquire a repository operation lock, even for read-only checks.
Existing explicit Git worktree locks and ordinary WT creation/cleanup safeguards remain independent; adapters do not unlock them.

Creation and switching require a clean source checkout as reported by Git using the repository's configured ignore rules.
The transition preflight deliberately does not override submodule-ignore configuration; the intended workflow does not hide submodule changes.
No adapter moves, stashes, resets, or copies working changes.
Missing conversations, altered task branches, invalid saved references, and directory mismatches stop the transition.
An `enter` request never invents a replacement for a missing saved conversation.
Successful native task entry records the first reference; a direct manual session remains independent unless its reference is explicitly saved with `wt session bind` from the task root.
Bindings cannot be overwritten through the session protocol.
Conversation discovery skips unreadable references with a CLI stderr diagnostic instead of blocking unrelated manual conversations.
Explicitly inspecting, binding, or verifying the affected task still rejects a damaged or symlinked reference without replacing it.

Cancelled, failed, and interrupted transitions cannot leave session locks because none are acquired.
A newly created worktree or forked conversation can remain after cancellation; inspect it rather than cleaning it automatically.
If native replacement fails after it starts, verify the actual host directory and conversation before retrying.
Do not clean a worktree to repair a conversation problem.
Claude native removal is blocked, including exit-time cleanup; only a separately authorized `wt clean` may remove a task after its ordinary checks.

## Verification and installation

`test/package-worktree.test.ts` exercises the installed Pi SDK under Node with disposable state and no provider calls.
`test/package-claude-worktree.test.ts` exercises Claude hook events against real disposable Git worktrees and WT.
`test/package-claude-worktree-runtime.test.ts` exercises native Claude entry and CLI resume on macOS with a bounded sandbox and synthetic provider.
`tools/worktree/tests/sessions.rs` checks the session protocol through its process boundary.
The package build bundles local Pi imports; the installed loader supplies its own SDK and TypeBox exports.
Normal user/project discovery remains enabled.
Building and testing never retarget installed links; installing these adapters into the live home requires separate approval.
