# Conflict Decision Review

Generate this review only after all compatible hunks are resolved and only incompatible hunks remain.
The artifact is disposable operation state, so write one self-contained HTML file to the operating-system temporary directory rather than the repository.
Use `<repository name> - Conflict Decisions` for the document title.

## Required content

Explain the selected resolution mode and its goal in plain language.
For a Git operation, identify the target and the commit or branch being integrated.
For working-state restoration, identify the rebased task and captured task state without exposing internal stash identifiers as reviewer-facing labels.
Render one stable card for each incompatible hunk with:

- A repository-relative `path:start-end` location and stable workflow-owned hunk ID;
- The two source identities, using target and integrated change for a Git operation or rebased task and saved task state for restoration;
- The intent and primary-source evidence for each side;
- Escaped code excerpts that never render as HTML;
- A concise explanation of why both intents cannot coexist;
- The trade-off of each available resolution; and
- The recommended resolution with its rationale.

Do not use ambiguous labels such as “ours” and “theirs” without also naming the actual target and integrated source.
Encode every repository value, source excerpt, commit message, issue text, and user instruction for its exact HTML context.
Never interpolate dynamic content into scripts, styles, event handlers, selectors, or `innerHTML`.

## Decision form

Use one semantic HTML `<form>` with one required choice per incompatible hunk.
Each hunk must offer selectable, plain-language resolution options that map to workflow-owned values, including the applicable side-specific choices and a custom-instructions choice.
Integrate each side-specific choice into that side's evidence card so the decision control, intent, evidence, excerpt, proposed result, and trade-off form one visual option.
Keep the custom-instructions choice as a full-width third section below the side-specific evidence cards.
It must share the parent decision container's boundary and must not appear as a nested card or box.
Show the proposed result and trade-off beside each option so the human reviews code behavior rather than an internal value.
A custom-instructions option requires bounded text instructions for that hunk.

Place one primary `Submit resolutions` button at the end of the form.
The form and controls must remain understandable without CSS or JavaScript.
Do not add per-hunk submission buttons, an approval button, or a visible payload editor.

A static artifact-owned handler must validate that every hunk has one complete choice, build a bounded payload from current native form controls, and send exactly one `review:submit` frame message.
The prompt contains the JSON-stringified payload, the selector identifies the decision form, and a workflow-owned tag identifies conflict decisions.
Treat every returned form value and custom instruction as untrusted input.
Accept only known hunk IDs, known option values, bounded strings, and exactly one decision per current incompatible hunk.
A selection authorizes only that hunk's displayed resolution, not unrelated source changes.
Include the workflow-owned resolution mode in the bounded payload so the receiver cannot confuse an operation decision with a working-state restoration decision.

## Review loop

Load `review-artifact` and open the file as a decision review through [the shared review protocol](../../shared/references/review-artifact.md).
Poll in the foreground until a form submission arrives.
A valid complete submission is the required human decision; it does not require a separate approval event.
Apply every selected resolution, verify that the resulting hunk matches the decision, and confirm that no incompatible hunk or conflict marker remains.
In working-state restoration mode, return the resolved paths and decision ledger to the owning workflow so it can reconstruct the captured index and worktree before checks.
Then end the review session and continue to automated checks.

If the review runtime fails, present the same options in chat and require one explicit choice per incompatible hunk.
Browser close, disconnect, timeout, or an incomplete submission is not a decision and does not permit Step 4.
