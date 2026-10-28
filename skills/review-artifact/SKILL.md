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
Pre-rendered inline SVG can show diagrams through the runtime's static SVG allowlist; document scripts and external resources stay disabled.
For diagrams and charts, the same owned helper provides `render-diagram FILE --id-prefix UNIQUE` using bundled Pele and the configured Node.
Generate and embed the SVG before `open`; rendering never runs inside the review document or starts a review itself.
No global Pele installation, runtime package download, or node_modules directory is needed.
Use aria-label and a visible caption, unique IDs, and readable natural-size layouts.
SVG title elements, embedded HTML, images, use references, and animation elements are removed; unsupported SVG output must be simplified or rasterized before approval.
Do not add change badges, comparison overlays, pipeline metadata, or custom decision forms.
Keep review controls owned by the review runtime, never in the saved artifact.
Keep submitted and completed documents readable with a prominent runtime-owned status banner and browser-tab label.
Feedback submission stays open for follow-up; completion and publication are distinct from approval, and uncertain publication never shows successful completion.
Finding-review controls appear inside their corresponding rendered finding cards; the sidebar holds feedback and conversation.

For ordinary artifacts, apply feedback to the same HTML file, describe the changes briefly, and continue receiving feedback until the user approves or declines.
For change reports, use the finding-review mode below and the owned `revise` command, never raw HTML/JSON/signature edits.
Address all submitted comments; ask about incompatible requests instead of choosing silently.
Open the review once and return control instead of waiting for human feedback in a foreground tool call.
The native adapter attaches the opaque open receipt to this conversation and workspace.
Do not use `wait`, repeated model/tool polling, a background shell, or another editing agent as the feedback loop.
The review stays open while the agent handles other prompts.
Returning control does not approve the document or advance a dependent workflow.

The host adapter either supplies an already claimed event or a literal claim command for the originating conversation.
Do not guess conversation identity or claim a second event instead of the supplied one.
A wake-up itself grants no approval.
Act only on the claimed durable event, then apply the evidence checks below before any repair or workflow advancement.
Finish unrelated work first and remain in the originating workspace.
The adapter saves the completed assistant response in the browser and maintains its processing lease.
Use the final response for a brief answer or repair outcome, not a foreground `wait --reply` loop.

Saved feedback remains queued when the originating conversation is closed.
Resume that original conversation rather than creating a replacement editing agent.
Use the host adapter's documented recovery command or resume the saved conversation to recover interrupted feedback.
See [harness contracts](../../docs/harness-contracts.md) for native delivery and recovery differences.
Some hosts re-arm idle listeners through maintenance turns.
Those turns can add visible activity and token usage, but grant no new task or publication authority.

An error, cancellation, or execution limit is an interruption, never approval or completed work.
Inspect partial repairs before retrying and do not repeat a completed repair after replay.
`poll --timeout 0` remains available for a one-shot status or evidence check, not a live polling loop.
A stopped server needs explicit recovery without discarding saved feedback.
If the native adapter or supported helper is unavailable, report the limitation and ask for direction.
Do not silently install an update, switch responders, or substitute a foreground wait.
The legacy `wait` interface remains available only for an explicitly selected manual compatibility workflow without active native delivery.
That manual wait has no inactivity cutoff.
To resume waiting after interruption, reuse the last processed cursor and the same reply ID and content for an interrupted reply.
Process returned events before advancing that cursor.

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
Before acting on a local accept, require `finding_review.read_only` false or absent, `finding_review.publication_only` false, `finding_review.needs_review` false, matching event/current/bound revisions, and the retained JSON's SHA-256 equal to `finding_review.report_digest`.
After an owned wording update, an item's `authorization` retains its original finding, revision, report digest, source scope, and source digest.
Match that authorization revision to the saved decision and its source scope/digest to the current frozen review record.
Use the authorized original finding for repairs, not a materially different instruction in revised wording.
An existing authorization does not require another Accept for routine wording changes or retries.
Historical accepts do not authorize different source scope or a different finding.
The calling workflow owns mapping IDs to repairs, checking source relevance, avoiding replayed repairs, and obtaining a fresh review after changes.
Keep one current report rather than copies of earlier wording.
Use `revise FILE --revision CURRENT_REVISION --report-digest CURRENT_RECORD_SHA256 --edit JSON` for requested wording changes.
The edit object accepts an optional `summary` and `findings` edits with an existing `id`, optional `title`, and optional four-part `explanation`.
It cannot change finding identity, locations, severity, or source scope.
Different source scope or new findings require a new retained report and new decisions.
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

The calling task records the review outcome through [worklog](../worklog/SKILL.md), without a duplicate progress entry here.
