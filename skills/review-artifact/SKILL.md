---
name: review-artifact
description: Review a local HTML document with element or selected-text comments, general side-panel feedback, live updates, and whole-document approval or decline.
---

# Review artifact

Review an existing HTML artifact; the calling task owns writing its content.
Use only the replacement-owned `../../tools/artifact-review/target/release/artifact-review`, resolved from this skill's absolute source path.
Read its `--help` and the relevant command help for the implemented interface.
Do not fall back to the original review runtime or install an external package.
If the executable is absent, state that browser review is not available yet and ask for direction rather than claiming review succeeded.

Keep the familiar document view and feedback side panel.
Support element and selected-text comments, general feedback, brief agent replies, and live reload without losing submitted feedback.
Use readable semantic HTML, plain language, and stable section identifiers.
Do not add change badges, comparison overlays, pipeline metadata, or custom decision forms.
Keep review controls in the review shell, not in the saved artifact.

Apply feedback to the same HTML file, describe the changes briefly, and continue receiving feedback until the user approves or declines.
Address all submitted comments; ask about incompatible requests instead of choosing silently.
Use `poll` in the foreground with the last processed cursor; process returned events before advancing that cursor.
Continue immediately when a page has `more: true`, or when an open review's bounded wait expires.
Retry an interrupted reply with the same reply ID and content, so it is not duplicated.
Do not background a wait that cannot resume this agent turn.

- **Send feedback** keeps the review open.
- **Approve** approves only the version the user reviewed, with no second confirmation.
- **Decline** ends the review without approval.
- Closing a tab, disconnecting, or a timeout is neither approval nor decline.

Material changes after approval require another review.
An `approved` status is historical when `needs_review` is true; do not accept it as approval of the current file.
Require matching current and approved revisions before advancing.
Do not advance another workflow merely because the browser closed or an operation returned successfully.
The calling task records the review outcome through [work-log](../work-log/SKILL.md), without a duplicate progress entry here.
