# Native task conversations

WT selects and validates task worktrees.
The installed harness adapter performs the native transition; neither `wt new` nor a child shell `cd` moves a running conversation.
New tasks carry the current conversation.
Existing tasks resume their saved conversation for the current harness, never an arbitrary recent conversation and never a transcript converted from the other harness.

## Shared continuation contract

A verified native transition resumes already-requested work without another user “continue” message.
The adapter delivers the shared `[WT continuation v1]` notice from `harnesses/worktree-client.ts` exactly once, after verifying the actual destination, repository, branch, and selected conversation.
The notice grants no new authorization: no pending work means report status, not invent another task.
The resumed conversation supplies the intent; entering an existing task must not replace it with incoming task instructions.

Hosts with an active agent loop attach the notice to the successful native tool result; hosts that replace an idle session start one turn through the replacement session's native API.
Never do both, send through an outgoing session, replay the notice as an action when loading history, or use shell/terminal input injection to simulate continuation.
Preparation, cancellation, verification failure, ordinary startup, manual session restore, and no-op transitions emit no continuation notice.
If a transition command bundles cleanup, cleanup must succeed before that command continues work.
A failed native tool may still receive the host's normal error-handling turn; it must not receive a success/continuation notice.
Unsupported hosts or transition modes must explain the limitation and exact manual step rather than silently stall or claim automatic continuation.

Every new harness adapter must document its native transport and unsupported modes, reuse this notice and authorization boundary, and provide conformance evidence:

- One destination model turn after successful new entry, saved-task entry, and return, preserving the correct conversation and using destination tools/context.
- No notice or extra scheduled turn on preparation, cancellation, failure, no-op, or history replay.
- No continuation before any bundled cleanup finishes, and none if that cleanup fails.
- A visible manual fallback when the host cannot initiate a verified continuation.

Use the Pi and Claude native-runtime suites below as reference fixtures, with disposable state and bounded synthetic providers.
A hook-only test or a notification is not evidence that the agent actually continued.

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
It then sends the shared continuation notice through that replacement context's `sendUserMessage`, starting exactly one destination turn with prompt-template expansion disabled.
This uses Pi's normal prompt pipeline to refresh destination instructions; a custom-message `triggerTurn` bypasses that refresh and must not be used here.
The user need not send “continue” after submitting `/wt`.
Ordinary startup and manual session switches do not acquire a task or require a saved conversation binding.
Pi 1.1.0's native session replacement API is required.
Print and RPC modes do not silently substitute a child process.

`/wt leave` forks the current selected conversation into the verified primary directory and replaces the native session there.
It does not resume an older primary conversation, overwrite the saved task reference, or remove anything.
Both source and destination must be clean; running it at primary is a no-op.
`/wt enter TASK` can still resume the saved task conversation after leaving.
`/wt clean TASK` requires explicit cleanup or successful-local-delivery authorization: it checks cleanup safety, carries the conversation to primary, verifies the replacement session, then reruns WT cleanup there.
A cancelled or failed transition never runs cleanup.
After a successful native return, `/wt clean` continues only after cleanup succeeds; a cleanup failure reports the incomplete operation without starting a turn.
Running leave or cleanup while already at primary does not replace the session or schedule a continuation.
The model-facing transition tool supports `leave` without a task and `clean` with an exact task, in addition to `new` and `enter`.

## Claude Code

For a new task, call native `EnterWorktree` with `name: TASK`.
The owned `WorktreeCreate` hook runs WT and returns its verified path.
Claude moves its own working directory while retaining the current conversation.
Alternatively, after an explicitly requested `wt new TASK`, call `EnterWorktree` with the returned `path`.
The entry hook validates that managed task and checks its saved conversation before Claude enters it.
Claude may request native permission to enter a path outside `.claude/worktrees`; do not bypass it.
The post-entry hook and subsequent tool hooks verify the actual host directory and conversation.
After successful entry or exit, the post-tool hook attaches the shared continuation notice as `additionalContext`.
Claude's native agent loop already runs the next model request; the adapter must not schedule a duplicate turn.

For an existing task, read `wt session inspect TASK --harness claude` using the package-owned executable.
Ask the user to run `/resume SESSION_ID` with its exact `conversation` value.
Claude's native resume restores the saved conversation and worktree binding.
A hook cannot invoke `/resume` on behalf of the interactive host, so do not claim the switch happened until the resumed session verifies its directory and saved conversation.
Interactive `/resume` also has no hook API to start a model turn: explicitly tell the user to send `continue` after resuming.
This mode does not meet automatic-continuation support; do not conceal that limitation.
The documented `SessionStart.initialUserMessage` applies only to non-interactive `-p`, not interactive resume, and is not a workaround.
See Claude's [SessionStart contract](https://code.claude.com/docs/en/hooks#sessionstart-decision-control).
If Claude resumes outside the recorded task, tools remain blocked rather than continuing in the wrong checkout.

Before starting another task from an existing task conversation, ask the user to run native `/branch` to preserve the original task conversation.
In the fork, use `ExitWorktree` with `action: keep`, then enter the new task.
The original session remains the existing task's saved conversation.
The fork has no saved binding of its own, so the exit hook independently verifies primary-directory arrival before emitting the continuation notice, without changing the original binding.
Do not reuse one conversation ID for multiple tasks or overwrite a saved binding.
These APIs were checked against Claude Code 2.1.296.
A sandboxed native-process test uses a loopback-only synthetic provider to verify entry, persisted history, resume, and the actual Bash working directory without live credentials.
Interactive `/branch` and `/resume` UI actions still require a human smoke test.
Native resume restores its worktree before `PreToolUse` verifies the saved conversation's directory.
No startup or shutdown hook tracks a session owner.
A manual conversation that is not a saved task reference is not rejected merely because it uses a task checkout.

The Claude-only `/wt leave` command guides native `ExitWorktree` with `action: keep`, preserving the conversation without cleanup.
The `PostToolUse` exit hook verifies primary-directory arrival before `wt session depart TASK --harness claude --conversation ID` records `atPrimary: true` on that saved reference.
Ordinary tool calls then verify primary instead of the former task directory; an unverified directory drift still blocks tools.
Re-entering that same task by native path binds the same conversation back to its task location.
After a departed conversation is resumed at primary, `/wt enter TASK` guides that path entry; entering a different task still requires `/branch`.
A failed departure record leaves the old location checks in force; stop and inspect the actual directory and saved reference rather than manually overwriting it.
For authorized delivery cleanup, verify native exit and then run `wt clean TASK --json` from primary.

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
Conversation identities cannot be overwritten through the session protocol.
Claude's verified native departure and re-entry update only the saved expected location, not the conversation identity.
Conversation discovery skips unreadable references with a CLI stderr diagnostic instead of blocking unrelated manual conversations.
Explicitly inspecting, binding, or verifying the affected task still rejects a damaged or symlinked reference without replacing it.

Cancelled, failed, and interrupted transitions cannot leave session locks because none are acquired.
A newly created worktree or forked conversation can remain after cancellation; inspect it rather than cleaning it automatically.
If native replacement fails after it starts, verify the actual host directory and conversation before retrying.
Do not clean a worktree to repair a conversation problem.
Claude native removal is blocked, including exit-time cleanup; only an explicitly authorized `wt clean` or successful local delivery may remove a task after its ordinary checks.
The running harness must reach primary first; a shell command cannot prove that transition.
Cleanup removes local task branches with exact-tip ancestry into the recorded local target or [synchronized merged-PR proof](../tools/worktree/README.md#cleanup-safety).
Squash and rebase merges need a matching exact-head merged PR, identical task and target trees, and equal local, remote-tracking, and live remote target commits.
Without either proof, the local branch remains.
Cleanup does not fetch or advance the integration branch.
A worktree removal followed by a branch-deletion failure is reported as partial cleanup with a nonzero exit status; never force the branch deletion.

## Verification and installation

`test/package-worktree.test.ts` exercises the installed Pi SDK under Node with disposable state and an offline synthetic provider.
It captures actual provider requests, checks their effective destination instructions, saved history, tool declarations, and notice-count increments for new, enter, leave, and clean.
It also checks cancellation, verification and cleanup failures, no-op leave, and history replay, and proves cleanup finishes before continuation.
`test/package-claude-worktree.test.ts` exercises Claude hook events against real disposable Git worktrees and WT, including unbound fork exits that preserve the original task reference.
`test/package-claude-worktree-runtime.test.ts` exercises native Claude entry and CLI resume on macOS with a bounded sandbox and synthetic provider.
It verifies one notice in the automatic post-entry/post-exit request, no duplicate turn, no replay on CLI resume, and no new notice after denied entry.
Its prompted CLI resume does not prove automatic interactive `/resume`; that mode remains explicitly unsupported.
`tools/worktree/tests/cases/sessions.rs`, included by `tests/cli.rs`, checks the session protocol through its process boundary.
The package build bundles local Pi imports; the installed loader supplies its own SDK and TypeBox exports.
Normal user/project discovery remains enabled.
Building and testing never retarget installed links; installing these adapters into the live home requires separate approval.
