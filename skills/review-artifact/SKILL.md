---
name: review-artifact
description: Review local HTML with annotations and revision-bound approval, or collect per-finding Accept/Reject repair decisions for a change-review report.
---

# Review artifact

Review an existing HTML artifact; the calling task owns writing its content.
Use only the replacement-owned `../../tools/artifact-review/target/release/artifact-review`, resolved from this skill's absolute source path.
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
Finding-review controls appear inside their corresponding rendered finding cards; the sidebar holds feedback and conversation.

For ordinary artifacts, apply feedback to the same HTML file, describe the changes briefly, and continue receiving feedback until the user approves or declines.
For retained change reports, use the finding-review mode below instead; never edit the signed report.
Address all submitted comments; ask about incompatible requests instead of choosing silently.
Use `poll` in the foreground with the last processed cursor; process returned events before advancing that cursor.
Continue immediately when a page has `more: true`, or when an open review's bounded wait expires.
Retry an interrupted reply with the same reply ID and content, so it is not duplicated.
Do not background a wait that cannot resume this agent turn.
Do not end the agent turn while the review is open merely to announce progress or ask a clarification question.
Send questions through `poll --reply` and keep listening until a terminal decision or an explicit user pause; ordinary Send feedback must not require a chat ping.
Polling receives live feedback only while this foreground loop runs; do not claim the browser can wake an ended or interrupted turn.

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
Check `open --help` for support; an unavailable mode is not permission to use ordinary Approve as repair authorization.
Only the human chooses Accept/Reject in the review shell; never submit decision events through agent tools.
Accept immediately authorizes repair of that exact finding; Reject and undecided findings authorize nothing.
The shell replaces whole-document Approve with Accept/Reject inside each rendered finding; End review stops new decisions without undoing saved accepts.
Comments and drafts accompany the clicked decision, and response-loss retries preserve the same submission ID and content.
A saved decision cannot be overwritten, including by reopening the same report.
Explicit chat clarification is required to revise a decision; a later rejection cannot undo repairs already performed.

Poll uses the same cursor contract and includes `finding_review` with `revision`, `report_digest`, `items` (ID, title, decision), and `needs_review`.
`accept` and `reject` events carry `finding` and `revision`; undecided items have a null decision.
`status: "decided"` means every finding has a decision, not that every finding was accepted or the code is approved.
An empty findings list grants no repair authority.
The ordinary top-level approval fields still describe whole-document approval, not finding decisions.
Before acting on an accept, require `finding_review.needs_review` false, matching event/current/bound revisions, and the retained JSON's SHA-256 equal to `finding_review.report_digest`.
Historical accepts remain in the log after file changes but do not authorize repairs against a different report.
The calling workflow owns mapping IDs to repairs, checking source relevance, avoiding replayed repairs, and obtaining a fresh review after changes.
Keep the old report immutable; new findings require a new retained report and new decisions.
No decision authorizes staging, committing, installation, delivery, or publication.

The calling task records the review outcome through [work-log](../work-log/SKILL.md), without a duplicate progress entry here.
