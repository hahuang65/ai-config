# Review Change Report

Write one self-contained HTML Review change report to the operating system temp directory.
Resolve the temp directory from `$TMPDIR`, then the platform temp convention, and name the file with a stable scope identity so build repair rounds update the same path.
Never write this disposable report into the repository or feature directory.
Build mode presents the report through `review-artifact` for its interactive decision loop.
Standalone modes open the completed report with the ordinary platform web browser and do not start a `review-artifact` session or wait for approval.

## Required content

The report contains:

- Authoritative intent and provenance;
- immutable base/head or working scope;
- overall risk and rationale;
- Findings grouped by severity without losing action, each displaying at least one exact `path:line` anchor;
- intent coverage;
- Validation evidence and reviewer-visible artifacts;
- documentation and lint outcomes;
- build-only canonical-artifact fact-check and idempotence outcomes;
- copyable provider-review text in pull-request mode, split into one general review comment and one standalone comment per Finding; and
- a persistent decision ledger covering every build-mode review and repair round.

Render from the latest validated state after all applicable stages complete.
Treat every dynamic value, including pull-request metadata, source excerpts, Finding text, evidence, instructions, and provider output, as Untrusted content.
Encode each value for its exact HTML text or attribute context, use `textContent` or form-control `value` for DOM updates, and never pass dynamic content through `innerHTML`, script, style, or event-handler interpolation.
Generate control IDs from workflow-owned safe identifiers rather than user text.
Render an Untrusted URL as text unless the workflow validates it as an expected `https:` provider URL or a report-owned local artifact URL before assigning it to a link target.
Keep resolved Findings in history but separate them visually from current Findings.
Write Finding titles and descriptions with terms found in Authoritative intent, source, tests, or project documentation; define any unavoidable new term at first use.
Render each Finding card's primary anchor in the card header using the same compact treatment: a right-aligned, high-contrast, monospaced badge with a visible border, rounded corners, and semibold text.
Display the repository-relative `path:line`, with the complete relative path rather than only the basename; on narrow layouts move the intact badge to its own line rather than dropping the path or line number.
Place a compact, accessible copy button directly beside every primary anchor.
The button copies the absolute source file path without the line suffix while the report continues to display only the repository-relative `path:line`.
Resolve that absolute path beneath the persistent source repository root supplied by the CLI or established before creating a disposable pull-request worktree, normalize it, and never emit a copy control for a path that escapes that root.
Store the copy value in a hidden text node, copy it through a static report-owned handler that reads `textContent`, never interpolate it into script or an event-handler attribute, and persistently mark the anchor copied after success.
In the pull-request copy section, keep each Finding's severity and `path:line` metadata outside its Markdown text so the user knows where to create the inline comment without copying that metadata into the comment.
Provide a compact copy-icon button inside each Markdown panel for the general review and every Finding comment; reserve enough panel padding that Markdown text never runs beneath or against the button, give it an accessible label, copy only the associated Markdown text through a static report-owned handler that reads `textContent`, never dynamic HTML, and persistently recolor or collapse the panel after a successful copy so completed actions remain visible.
Before the Finding cards, render a concise legend for every severity (`error`, `warning`, `info`) and action (`auto-fix`, `ask-user`, `no-op`), explaining impact, who decides next, and that standalone tags never trigger a mutation.
Never replace a line anchor with only a symbol, block name, filename, or commit reference.

## Build-mode interaction

In mutating build modes, the user can select or add Findings, attach instructions, fix selected Findings, or approve as-is after every `ask-user` Finding has an explicit disposition; the report updates in place after any repair round.
Use ordinary portable HTML and native controls: checkboxes for eligible selection, radio buttons or selects for explicit disposition, textareas for per-Finding instructions, and buttons for add Finding, fix selected, and approve as-is.
Give every Finding control a stable Finding ID and every question a stable queue key.
Do not require presenter CSS, JavaScript, or network access for the report to render.

An `ask-user` Finding must have an explicit disposition before approve-as-is can be queued in build mode.
Client-side validation may explain missing dispositions, but the invoking skill must enforce the same rule after receiving feedback.

Render one copyable structured decision payload containing action, selected Finding IDs, added Findings, instructions, and dispositions.
The user submits it through the `review-artifact` message or annotation surface; chat fallback accepts the same payload.
Never assume that clicking a report control by itself authorizes a mutation; only feedback returned by the foreground review poll or explicitly submitted in chat does.

Load `review-artifact` and follow the [shared review protocol](../../shared/references/review-artifact.md) for build-mode opening, foreground polling, feedback, live reload, and explicit approval.
Do not duplicate or guess its CLI commands in Review change.
Treat only its `approved` event as browser approval; `ended`, disconnect, browser close, and timeout never clear the build gate.
If the runtime fails to start, present the complete report in chat and preserve identical explicit-disposition and approval semantics.

## Standalone presentation

In pull-request, explicit-range, standalone skill, and standalone CLI modes, omit fix-selected, approval, disposition, and other mutation or decision controls.
Retain the complete results, HTML report, and pull-request copyable Markdown.
Opening the report is presentation only: return after successful viewer dispatch and do not poll for feedback, require approval, wait for viewer closure, or otherwise block completion on browser interaction.
When `REVIEW_CHANGE_GATE=1`, write the report into the provided report root, report its path, and return after the report stage; the parent CLI validates and launches the single generated HTML file in a new Firefox window through a `file:` URL on macOS or uses the platform HTML viewer elsewhere.
In an ordinary agent session, open the completed HTML file once with the platform's normal file opener and return the review results in chat.
If opening fails, report the path and failure so the user can open the retained HTML manually.

## Terminal fallback

Print the report path plus a concise summary of intent, scope, risk, current Findings by severity and action, evidence, and stage outcomes.
Build mode accepts its mode-appropriate decisions in conversation when browser review cannot start.
Read-only standalone modes report results and never offer or accept fix-selected or approval actions.

## Update loop

In a mutating build mode, after feedback requests a repair, apply mode ownership, rerun from the earliest applicable stage, rewrite the same report path from final stage state, and resume the existing foreground review poll after live reload.
Preserve the decision ledger across build-mode updates.
End the build review session when the user approves or explicitly ends review; ending without approval leaves the build gate uncleared.
Standalone modes have no update or approval loop and finish after opening the report.
