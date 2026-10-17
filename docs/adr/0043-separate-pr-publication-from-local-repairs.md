# Separate PR publication from local repairs

Status: accepted.

## Problem

PR reports offered repair Accept/Reject alongside separate publication controls.
The optional decision comment was a local repair note, not the comment sent to GitHub.
The user interpreted acceptance as publication selection and explicitly wants PR review only to choose and edit comments, never to authorize repairs.
The sidebar must remain for feedback with the agent, without a separate Preview step.

## Decision

Local reports retain revision-bound Accept/Reject repair decisions and optional local decision comments.
PR reports instead use unchecked publication checkboxes beside prefilled editable comments.
The default text comes from the finding explanation without adding internal finding IDs.
Selected text is submitted verbatim, without trimming, Markdown escaping, title prefixes or identifier wrappers, to the finding's immutable verified file, side and line.
A finding without a verified inline location cannot be selected or fall back to a review-body comment.
The retained HTML and JSON are never rewritten for edits or selections.

The runtime owns the editors and the Publish button appended below the document.
The visible comment text, destinations, account, PR and available reviewed-revision details form the confirmation view.
One human Publish click confirms that exact set; there is no separate Preview button or second confirmation.
Selection and editing alone do not publish.
The sidebar remains for feedback, including after publication and when there are no findings.
PR mode rejects repair decisions and whole-document approval; only End review ends its feedback session.

The backend retains signed short-lived preparation, account and open-PR scope checks, locking, a persisted attempt, receipts and reconciliation.
Preparation validates the account and revisions shown before the click, and confirmation rechecks them before mutation.
A changed account or scope requires renewed inspection and a new human action, never silent submission to the new context.
A lost response reconciles the existing attempt rather than sending another POST.
Publication sends COMMENT, never APPROVE or REQUEST_CHANGES.

Legacy configuration may be enriched with publication-only mode only for the same exact report digest, revision and finding list.
Existing events remain unchanged; historical PR accepts are neither repair authority nor publication selections.
Older tracked servers must be restarted with the current executable before using the new mode, without resetting their history.

## Alternatives and consequences

Keeping both repair and publication choices on PR cards was rejected because PR repair is not part of the user's workflow.
Requiring a separate generated-request preview was rejected because the editable inline comments and displayed destinations already show what will be published.
Posting unverified findings as summary comments was rejected because the user requires the designated file and line.

Comments remain bounded to 8000 UTF-8 bytes each and at most 50 selected findings.
Only the publication-preparation request allows up to 1 MiB to carry that bounded set; ordinary feedback keeps its existing request bound.
Drafts are keyed by record digest and finding ID in the tab's private session storage, not inferred from repair history.
A published report shows its posted status rather than recreating editors with potentially different default text.

This supersedes ADR 0042's separate-preview interaction, not its CLI, retained-state, isolation or reconciliation decisions.
Only the human selects and edits publication comments and clicks Publish.
Model tools must not call publication endpoints, manufacture selections or confirmation, or use the legacy terminal posting path.
The same-user capability and signing key still do not cryptographically prove a human gesture.
No implementation approval authorizes live publication, installation, commits or delivery.
