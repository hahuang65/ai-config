# Deliver review feedback without a foreground wait

Status: accepted.

## Problem

Keeping a foreground artifact wait active prevents the agent from handling other prompts.
Ending that turn without a native delivery mechanism leaves browser feedback waiting for a manual chat prompt.
Standalone CLI reviews have no originating conversation to resume.

## Decision

Keep durable feedback jobs in the existing local artifact-review SQLite store.
Bind agent-launched reviews to the actual harness, saved conversation, and canonical workspace through an opaque open receipt.
Use Pi native follow-ups and Claude native `asyncRewake` hooks.
A busy conversation finishes its current request before handling feedback.
A closed conversation retains feedback until that original conversation resumes.
Never replace the original conversation with another editing agent.

Claim an event only when its responder begins processing it.
Use attempt tokens and renewable leases, invalidate interrupted attempts, and save one idempotent completion reply.
The shared submission banner distinguishes Queued, Working, Answered, Updated, and Needs attention from approval and publication.
Keep frozen source evidence and authorization records separate from report presentation and processing state.
Draft preservation and recovery of failed work are not requirements for this single-person workflow.
A failed review must not block a healthy replacement in the same conversation.
Skip unavailable per-review inboxes and renewals, clear failed lease tracking, and report the skip without reopening old servers.
Do not hide shared routing-state failures.

Claude re-arms listeners after processing and uses a maintenance turn before the native hook timeout.
Maintenance grants no new task, repair, commit, installation, or publication authority.
A short synchronous completion hook prevents the next user prompt from discarding or replacing the browser reply.
Synchronous startup and completed worktree-transition hooks record the conversation's current canonical workspace.
Listeners stop notifying for inactive workspaces, and claims reject an inactive workspace or a caller in another directory.
Re-entry makes unclaimed feedback eligible for notification again, without rerouting its origin.
No Channels entitlement or organization-policy bypass is required.

A standalone CLI review instead starts a restricted responder only when feedback arrives.
Use the retained engine options and verified frozen evidence with the existing snapshot-only runner.
These responders never repair source, execute it, delegate work, or publish, including for local and range targets.
A CLI invoked within an agent conversation remains agent-launched.
Human-controlled publication remains governed by [ADR 0043](0043-separate-pr-publication-from-local-repairs.md).

## One current report

Apply requested wording changes to the same report path through an owned, signed update.
Use ordinary atomic file replacement, but no update journal, rollback, or automatic crash replay.
If an interrupted multi-file update leaves an invalid report, reject it and let the user generate another report.
Use one 25 MiB bound for HTML, report JSON, individual renders, and aggregate decoded renders.
Do not archive complete earlier reports or create a version-navigation workflow.
The restricted responder proposes edits, and the owning runtime validates its live claim before applying them.
Wording edits cannot change source scope, finding IDs, locations, severity, or execution authority.
A verified new binding refreshes the displayed report even after final decisions or End review, without reopening controls.

Routine wording edits and retries do not invalidate existing authorizations.
Keep the originally authorized finding and source scope separately for local repairs.
Unconfirmed drafts and publication selections may be discarded after a wording update or failure.
Keep the exact confirmed publication payload, attempt, and outcome.
Discarding a draft never authorizes publication of replacement text.
An uncertain attempt remains the same attempt after a wording update and is reconciled without another POST.
A new publication payload still needs its own explicit human confirmation.
A genuine source-scope change requires a fresh review rather than borrowing an earlier authorization.

This replaces earlier whole-report immutability constraints, not ADR 0043's human publication controls.

## Alternatives and consequences

Foreground waits remain explicit compatibility interfaces, not the default workflow.
Repeated model polling was rejected because waiting should not require continuous model calls.
Native Channels were investigated but were unavailable in the available Claude profiles.
Ordinary MCP connection and successful notification writes do not establish model delivery.

Claude idle renewal can create visible maintenance activity and token usage.
Standalone waiting has no idle model and requires no maintenance turn.
Synthetic native fixtures prove delivery, sequencing, interruption handling, and completion plumbing, not live-provider or organization-policy eligibility.
They do not establish crash-recovery or draft-preservation guarantees.
Implementation does not install resources, change live authentication, authorize publication, or imply commit permission.
