# Review Change Report

Write one self-contained HTML Review change report to the operating system temp directory.
Use `<change title> - Review Findings` in its `<title>` so the browser tab identifies the reviewed change and the document intent.
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
- a Review publication selection form in exact GitHub pull-request mode, using validated provider identity, actor, exact base and head, and each Finding's path, line, and side; and
- a persistent decision ledger covering every build-mode review and repair round.

Render from the latest validated state after all applicable stages complete.
Treat every dynamic value, including pull-request metadata, source excerpts, Finding text, evidence, instructions, and provider output, as Untrusted content.
Encode each value for its exact HTML text or attribute context, use `textContent` or form-control `value` for DOM updates, and never pass dynamic content through `innerHTML`, script, style, or event-handler interpolation.
Generate control IDs from workflow-owned safe identifiers rather than user text.
Render an Untrusted URL as text unless the workflow validates it as an expected `https:` provider URL or a report-owned local artifact URL before assigning it to a link target.
Keep resolved Findings in history but separate them visually from current Findings.
Write all visible report content, including every surfaced Finding, in plain language.
Lead each Finding with its concrete impact and recommended change.
Keep exact machine values, commands, identifiers, and paths secondary.
Do not use unexplained workflow, security, protocol, provider, or implementation jargon.
Prefer the ubiquitous language from the selected context documentation.
Then prefer wording from Authoritative intent, source, tests, and project documentation, followed by common technical terms the user is likely to know.
Define any unavoidable unfamiliar term beside its first use.
Show human-readable labels as the primary text for machine values such as severity, action, disposition, and stage status; keep exact machine values in secondary metadata only when they help diagnose or submit the review.
Render each Finding card's primary anchor in the card header using the same compact treatment: a right-aligned, high-contrast, monospaced badge with a visible border, rounded corners, and semibold text.
Display the repository-relative `path:line`, with the complete relative path rather than only the basename; on narrow layouts move the intact badge to its own line rather than dropping the path or line number.
Place a compact, accessible copy button directly beside every primary anchor.
The button copies the absolute reviewed file path without the line suffix while the report continues to display only the repository-relative `path:line`.
Resolve that absolute path beneath the checkout or worktree containing the materialized reviewed snapshot, normalize it, and never emit a copy control for a path that escapes that review root.
In standalone CLI mode, use the isolated `reviewRoot` rather than `sourceRoot`, retain it until final Summary dismissal, then remove it.
In other modes, use the active checkout or disposable pull-request worktree used to inspect the reviewed state rather than a different persistent checkout.
Keep a disposable review root alive while its review presentation is active so copied paths remain valid.
Store the copy value in a hidden text node, copy it through a static report-owned handler that reads `textContent`, never interpolate it into script or an event-handler attribute, and persistently mark the anchor copied after success.
In exact GitHub pull-request mode, replace the retired manual comment-copy panels with one Review publication selection form.
Carry each inline Finding's explicit diff `side` from the structured reviewer result: `LEFT` means an old or deleted line, and `RIGHT` means a new, added, or current line.
Never infer, default, or remap a missing or invalid side during report assembly.
Keep such a Finding presentation-only and explain that Review publication is unavailable for that location.
Select every current Finding initially and let the reviewer clear irrelevant Findings through native checkboxes.
Keep general and inline comment text read-only.
Derive the general comment from only the selected Finding titles.
Submit through a top-level `POST` form whose action is `http://127.0.0.1:4392/api/v1/review-publication-confirmations`: put the signed publication envelope in one hidden `publication_token` field and use `selected_finding_id` for each selected stable Finding ID.
The browser's final Post review action requests publication but is not sufficient authority.
After the publisher validates the signed confirmation token and exact selected content, it must show a bounded operating-system confirmation outside model-visible channels and immediately before the provider stage that can mutate.
The prompt identifies the exact actor, repository, pull request, base commit, head commit, selected Finding count, and whether inline comments are included.
Only explicit operating-system approval continues; cancellation, dismissal, timeout, unavailable UI, malformed response, process failure, and request cancellation fail closed without provider mutation.
The standalone CLI parent freezes the required `github.com` host, repository and pull-request identities, exact base and head, signing-key identifier `review-publication-v1`, and comment-template version `1` in a signed scope before the model runs.
For an ordinary skill invocation, the installed boundary in both supported harnesses recognizes the complete exact GitHub pull-request token in the user's Review change invocation.
It validates the whole token through the shared GitHub target parser and freezes the current provider identity, base, and head before model work.
In pi, call `review_change_publication` with `action: scope` before authoring publication claims.
Use only the returned frozen identity; do not use review text, helper arguments, or model-authored metadata as trusted publication scope.
Never accept, predict, or pass an operating-system approval response through the HTTP request, signed report, environment, or helper arguments.
After the Findings are final, call `review_change_publication` with `action: render` and only the Finding ID, title, immutable body, path, line, and side.
The pi tool does not accept a host, repository, pull request, base, head, signing-key identifier, comment-template version, actor, report identity, output path, or helper command from the reviewer.
Embed the returned signed fragment unchanged in the completed report.
The extension keeps the frozen scope in harness-owned memory, preserves it across steering and queued follow-up input, and supersedes it only for a new recognized Review change invocation.
In Claude Code, the supported `UserPromptSubmit` hook stores the signed frozen scope in trusted state for the current harness session before the reviewer starts and supplies only its bounded public identity to the model.
After the Findings are final, use the `Write` tool to write only `{"findings":[...]}` to the intended `.review-fragment` path.
The trusted `PreToolUse` hook replaces those Finding claims with the signed form bound to the latest recognized Review change invocation in that session.
Do not submit a frozen scope or call the publication helper in a direct Claude Code session.
The trusted boundary generates the random report identity, resolves the current actor, rejects a pull request whose base or head changed after freezing, signs the claims against the invocation's frozen scope, and writes the deterministic shared form.
Embed the returned `.review-fragment` file unchanged in the completed report.
In standalone CLI mode, create the same form through the exact parent-provided absolute signer: write one bounded temporary claims file beside the report with the parent-frozen scope and every Finding's immutable body, path, line, and side, then invoke `<absolute-helper-path> --sign <claims-file> <form.review-fragment>`.
The fixed `.review-fragment` suffix keeps the temporary form fragment outside the report viewer's `.html` count.
Every production report-signing path requires the repository, pull request, base, and head frozen for the current invocation, and no generic production interface signs unfrozen model-authored claims.
The signer rejects claims whose host, repository, pull request, base, head, key identifier, or comment-template version differs from the frozen trusted scope.
The mandatory shared guardrails treat the complete `~/.review-publication/` directory, including its signing key, as protected credential state for ordinary model file and shell tools in both harnesses.
The separately installed socket worker and trusted pre-model harness boundaries use the key outside model tool calls.
This boundary prevents mistakes and ordinary model tool access; it does not claim operating-system isolation from hostile code with unrestricted user-account access.
Every other standalone target remains presentation-only and contains no Review publication, selection form, signed envelope, or provider action.
Before the Finding cards, render a concise legend with human-readable labels for every severity (`error`, `warning`, `info`) and action (`auto-fix`, `ask-user`, `no-op`), explaining impact, who decides next, and that standalone tags never trigger a mutation.
Never replace a line anchor with only a symbol, block name, filename, or commit reference.

## Build-mode interaction

In mutating build modes, the user can select or add Findings, attach instructions, request fixes, or approve as-is after every `ask-user` Finding has an explicit disposition; the report updates in place after any repair round.
Wrap all build decisions in one HTML `<form>` with a stable safe ID such as `review-decisions`.
Place every control for an existing Finding inside that Finding's card: its selection checkbox when eligible, plain-language disposition choices, and its instruction textarea.
Make every decision control a successful control of that one form.
When a Finding card is not a descendant of the form element, put `form="review-decisions"` on each of its inputs, textareas, and buttons so `form.elements` and `new FormData(form)` include it.
Keep the stable Finding ID in the control value or safe metadata, not as a label the user must interpret.
Provide a clearly labelled section inside the form for a user-authored Finding.
Require an exact changed `path:line` anchor and a source-verifiable acceptance statement before a user-authored Finding can be selected for repair; these values form its neutral prior Finding record.
Near the end of the form, present one plain-language “What should happen next?” choice for fixing selected issues or approving the change as-is.
At the bottom render one primary `Submit decisions` button rather than separate payload, copy, fix, or approve buttons.
Give every Finding control a stable Finding ID and every question a stable queue key.
The form and its controls must remain readable without CSS, JavaScript, or network access.

An `ask-user` Finding must have an explicit disposition before approve-as-is can be submitted in build mode.
The static report-owned form handler validates this in the browser, and the invoking skill enforces the same rule after receiving feedback.
For each validation failure, name the exact Finding and unmet condition or name the choices that conflict; never use one generic error for distinct failures.

The form handler builds the structured decision payload in the background from current form controls, containing action, selected Finding IDs, added Findings, instructions, and dispositions.
It must not display the structured payload or ask the user to build, copy, or paste it.
On valid submission, send exactly one bounded frame message with type: `review:submit` and one nested `prompt` object whose `prompt` field is the JSON-stringified payload, whose `selector` identifies the form, and whose workflow-owned `tag` identifies Review change decisions.
Do not place the prompt text, selector, or tag beside the nested `prompt` object at the frame-message root.
Set `completion` to `approve` only for a validated approve-as-is decision, and set `completion` to `end` for a repair request.
Build the object from form-control values and `JSON.stringify` it at submit time; never interpolate Finding text, instructions, or other dynamic values into executable script.
The `review-artifact` shell submits that message through the foreground review poll and shows its completed-review splash screen.
Chat fallback accepts the same decisions in plain conversation and does not require payload syntax.
Never assume that changing a report control by itself authorizes a mutation; only the submitted feedback returned by the foreground review poll or explicitly stated in chat does.
A validated approve-as-is submission produces browser approval through the same terminal action as the review shell's Approve control; do not ask the user to approve a second time.

Load `review-artifact` and follow the [shared review protocol](../../shared/references/review-artifact.md) for build-mode opening as a decision review, foreground polling, feedback, live reload, and explicit approval.
Do not duplicate or guess its CLI commands in Review change.
Treat only its `approved` event as browser approval; `ended`, disconnect, browser close, and timeout never clear the build gate.
If the runtime fails to start, present the complete report in chat and preserve identical explicit-disposition and approval semantics.

## Standalone presentation

In pull-request, explicit-range, standalone skill, and standalone CLI modes, omit fix-selected, approval, disposition, and other mutation or decision controls.
Retain the complete results and HTML report.
For an exact GitHub pull request, retain its Review publication selection form without starting a publisher or agent poll until the reviewer continues.
Opening the report is presentation only: return after successful viewer dispatch and do not poll for feedback, require approval, wait for viewer closure, or otherwise block completion on browser interaction.
When `REVIEW_CHANGE_GATE=1`, write the report into the provided report root, report its path, and return after the report stage; the parent CLI validates and launches the single generated HTML file in a new Firefox window through a `file:` URL on macOS or uses the platform HTML viewer elsewhere.
The parent retains the isolated review root while its final Summary is visible, then removes that root after the user dismisses the CLI.
In an ordinary agent session, open the completed HTML file once with the platform's normal file opener and return the review results in chat.
If opening fails, report the path and failure so the user can open the retained HTML manually.

## Terminal fallback

Print the report path plus a concise summary of intent, scope, risk, current Findings by severity and action, evidence, and stage outcomes.
Build mode accepts its mode-appropriate decisions in conversation when browser review cannot start.
Read-only standalone modes report results and never offer or accept fix-selected or approval actions.

## Update loop

In a mutating build mode, after a submitted decision requests a repair and ends the current review, apply mode ownership, rerun from the earliest applicable stage, and rewrite the same report path from final stage state.
Because the report materially changed, reopen it as a decision review with `--reopen` and start a new foreground poll rather than leaving the user at a completed session.
Preserve the decision ledger across build-mode updates.
Approval ends the build review and clears the gate; an ended repair-request review leaves the gate uncleared until the materially changed report is reopened and approved.
Standalone modes have no update or approval loop and finish after opening the report.
