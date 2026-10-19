---
name: review-artifact
description: Review local HTML with annotations and revision-bound approval, collect local finding repair decisions, or select editable inline PR comments for human-confirmed publication.
---

# Review artifact

Review an existing HTML artifact; the calling task owns writing its content.
Use only the replacement-owned `../../tools/artifact-review/target/release/review-artifact`, resolved from this skill's absolute source path.
This is a source-local helper with no shell PATH alias; do not resolve an unrelated executable by name.
Read its `--help` and the relevant command help for the implemented interface.
Do not fall back to the original review runtime or install an external package.
If the executable is absent, state that browser review is not available yet and ask for direction rather than claiming review succeeded.

Keep the familiar document view and feedback side panel.
Support element and selected-text comments, general feedback, brief agent replies, and live reload without losing submitted feedback.
Selecting a target outlines it and opens the comment editor beside it; queued comments and conversation stay in the sidebar.
Retain draft target text and revision if a reload prevents safely locating the original selection.
Use readable semantic HTML, plain language, and stable section identifiers.
Do not add change badges, comparison overlays, pipeline metadata, or custom decision forms.
Keep review controls owned by the review runtime, never in the saved artifact.
Keep submitted and completed documents readable with a prominent runtime-owned status banner and browser-tab label.
Feedback submission stays open for follow-up; completion and publication are distinct from approval, and uncertain publication never shows successful completion.
Finding-review controls appear inside their corresponding rendered finding cards; the sidebar holds feedback and conversation.

For ordinary artifacts, apply feedback to the same HTML file, describe the changes briefly, and continue receiving feedback until the user approves or declines.
For retained change reports, use the finding-review mode below instead; never edit the signed report.
Address all submitted comments; ask about incompatible requests instead of choosing silently.
Use `wait FILE --cursor CURSOR` in the foreground with the last processed cursor; process returned events before advancing that cursor.
The logical wait has no inactivity cutoff: keep the agent turn active until feedback arrives, then handle it and wait again while the review remains open.
Use no shell-tool timeout when the harness supports that; do not replace the wait with repeated bounded model/tool calls.
Continue immediately when a page has `more: true`; the command handles empty transport heartbeats and connection timeouts internally.
`poll --timeout 0` remains available for an explicit one-shot status check, not as the live feedback loop.
Retry an interrupted reply with the same reply ID and content, so it is not duplicated.
Do not background a wait that cannot resume this agent turn.
Do not end the agent turn while the review is open merely to announce progress or ask a clarification question.
Send questions through `wait --reply` and keep listening until a terminal decision or an explicit user pause; ordinary Send feedback must not require a chat ping.
An error, cancellation, or harness execution limit is an interruption, never approval or a reason to discard saved feedback.
If interrupted, the user can ask to resume waiting on the same review with the last processed cursor and any pending reply ID.
Report a stopped or incompatible server explicitly; do not silently reopen a terminal review or install an update.
If this executable lacks `wait`, explain the limitation rather than quietly falling back to a busy polling loop.
No automatic mechanism to wake an ended agent turn is required or claimed.

- **Send feedback** keeps the review open.
- **Approve** approves only the version the user reviewed, with no second confirmation.
- **Decline** ends the review without approval.
- Closing a tab, disconnecting, or a timeout is neither approval nor decline.

Material changes after approval require another review.
An `approved` status is historical when `needs_review` is true; do not accept it as approval of the current file.
Require matching current and approved revisions before advancing.
Do not advance another workflow merely because the browser closed or an operation returned successfully.
## Finding-review mode

Use `open REPORT.html --findings REPORT.json` only with the matching retained change-review record.
The record selects local repair mode or PR publication-only mode.
Check `open --help` for support; an unavailable mode is not permission to use ordinary Approve as repair authorization.
The following repair-decision rules apply only to local reports.
Only the human chooses Accept/Reject in the review shell; never submit decision events through agent tools.
Accept immediately authorizes repair of that exact finding; Reject and undecided findings authorize nothing.
The shell replaces whole-document Approve with Accept/Reject inside each rendered finding; End review stops new decisions without undoing saved accepts.
Comments and drafts accompany the clicked decision, and response-loss retries preserve the same submission ID and content.
Each card's optional decision comment accompanies only that finding's Accept or Reject, in the event's `message`; other cards' comments remain drafts.
When general feedback is included too, labeled sections distinguish it from the finding comment.
A comment alone grants no repair authority.
A saved decision cannot be overwritten, including by reopening the same report.
Explicit chat clarification is required to revise a decision; a later rejection cannot undo repairs already performed.

`wait` and `poll` use the same cursor contract and include `finding_review` with `publication_only`, `revision`, `report_digest`, `items` (ID, title, decision), and `needs_review`.
When `publication_only` is true, PR selections and historical decisions grant no repair authority; keep receiving feedback until End review, even after publication or with zero findings.
`accept` and `reject` events carry `finding` and `revision`; undecided items have a null decision.
`status: "decided"` means every finding has a decision, not that every finding was accepted or the code is approved.
An empty findings list grants no repair authority.
The ordinary top-level approval fields still describe whole-document approval, not finding decisions.
Before acting on a local accept, require `finding_review.publication_only` false, `finding_review.needs_review` false, matching event/current/bound revisions, and the retained JSON's SHA-256 equal to `finding_review.report_digest`.
Historical accepts remain in the log after file changes but do not authorize repairs against a different report.
The calling workflow owns mapping IDs to repairs, checking source relevance, avoiding replayed repairs, and obtaining a fresh review after changes.
Keep the old report immutable; new findings require a new retained report and new decisions.
No finding decision authorizes staging, committing, installation, delivery, or publication.

## Publication confirmation

PR reports never authorize repairs and show no Accept/Reject controls.
The runtime adds unchecked checkboxes and prefilled editable comments inside the corresponding cards, with one Publish button below the document; the sidebar stays for agent feedback.
Each comment starts from the finding explanation without adding internal finding IDs.
New reports use Markdown with bold section headings; edited text is still sent verbatim.
The existing PR URL in Scope and intent is a normal clickable anchor, independent of publication checks.
The shell preserves safe GitHub PR links and opens them in a separate tab; document scripts remain disabled.
Only checked comments are sent, verbatim, to their immutable verified file, side and line; unverified locations cannot be selected or posted as summary comments.
Selections and edits alone do not publish, and local decision notes are not publication comments.
Only the human selects and edits comments, inspects the visible text, destinations, account and PR context, then clicks Publish as the final confirmation.
There is no separate Preview step; the backend still signs preparation and rechecks the exact scope and account before mutation.
Stale reports, changed PR scope or account, and expired preparations are refused before a new submission.
Model tools must never choose publication findings, edit publication drafts, call publication endpoints, synthesize confirmation clicks, or treat historical PR Accept events as repair or publication permission.
Ordinary artifact Approve, End review, silence, and browser closure do not publish.
An uncertain outcome is reconciled from the same report with Check publication status, never blindly resubmitted.
This same-user browser capability is not proof against arbitrary code running as that OS user.
The retired publisher and protected legacy state remain off limits.

The calling task records the review outcome through [work-log](../work-log/SKILL.md), without a duplicate progress entry here.
