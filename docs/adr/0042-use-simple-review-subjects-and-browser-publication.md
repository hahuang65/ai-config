# Use simple review subjects and browser publication

Status: accepted.

## Problem

The human CLI required a target subcommand, manual intent, and a separate terminal publication workflow.
The user wants `review-change [SUBJECT]` and handles the resulting report entirely in `review-artifact`.
A PR URL is the common subject; branch/worktree names, GitHub URLs, explicit two-dot Git ranges, and the current working scope also need clear meanings.

## Decision

Human invocation takes one optional subject, not an interactive menu or report-management commands.
No subject reviews the current branch and outstanding changes from its merge base with trunk.
An exact branch wins over a worktree-name match; a selected registered worktree contributes its outstanding changes, while an unchecked-out branch contributes committed changes only.
Resolve trunk from remote default metadata, preferring origin, then an unambiguous local main/master; fail instead of guessing.
Explicit ranges use Git's revision resolver and compare exact endpoints, not their merge base.
GitHub URLs name their repository independently of the invocation directory.
Missing remote objects are acquired without checkout in a private temporary repository, with a bounded fetch and no changes to development refs or indexes.
Untrusted source is never executed.

Human reviews collect bounded PR and commit context automatically, labelling it as unverified intent rather than invented acceptance criteria.
Explicit `--intent` remains useful to agents with an approved request or specification.
Existing explicit review forms and structured JSON receipts remain compatible; JSON never opens a browser or publishes.

The user explicitly selected the browser as the final human publication confirmation.
Authoring guidance therefore requires human confirmation of the exact publication preview, not a specific terminal interface.
The report opens in `review-artifact`, with publication controls separate from repair Accept/Reject.
A human selects comments, requests an exact preview showing the GitHub account, PR, revisions and COMMENT payload, then clicks Publish comments.
That click is the final confirmation; there is no later terminal or operating-system prompt.
Selection changes cancel the displayed preview.

The artifact tool links the existing Rust review library rather than adding an executable or restoring the retired publisher.
The backend verifies the retained report and binding, signs an immutable short-lived preview, rechecks the account and exact open PR scope before mutation, and uses the existing per-report lock, persisted attempt, receipt and reconciliation marker.
A lost response is reconciled from the same attempt; it is never a blind resubmission.
The report retains its command-source exclusions in a signed sidecar using that same store, so an independent agent open or server restart does not lose the executable safety boundary.
Legacy terminal posting remains an unadvertised compatibility path for retained reports and existing consumers, not the human workflow.

## Alternatives and consequences

A terminal menu and `reports`, `open ID`, and `post ID` were rejected as unnecessary interface surface.
Mandatory manual intent was rejected because humans generally will not enter it.
Requiring terminal or operating-system confirmation after the browser preview was rejected in favor of one explicit human confirmation in the report.

This supersedes the confirmation-interface choice in ADR 0040 and the historical publisher design in ADR 0038, not protected-state access restrictions or retained evidence.
Model tools must never choose findings for publication or submit preview/confirmation requests on a human's behalf.
A repair decision, ordinary artifact approval, review completion, silence, or browser closure grants no publication authority.
The local capability and same-user signing key do not cryptographically prove a human gesture or resist arbitrary code running as that OS user; that limitation remains explicit.
No live provider mutation, installed-source switch, protected-state migration, commit or delivery follows from implementation approval.
