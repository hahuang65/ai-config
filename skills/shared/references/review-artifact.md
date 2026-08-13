# Review Artifact Protocol

Shared protocol for any skill that presents an HTML artifact to request feedback, a decision, or approval.
The invoking skill generates the canonical semantic HTML; `review-artifact` owns only the browser feedback loop.

## When it applies

Use `review-artifact` whenever the next user action is to inspect an HTML file and respond about its contents.
Examples include approving a spec, refining tasks, choosing whether to act on an architectural review finding, or approving a Spec sketch with more than four modules.
Do not start a review session for HTML that is only being displayed for information with no response requested.

## Review purpose and document title

Declare the purpose when opening the review:

- Feedback and approval reviews start in **Annotate** mode so element and selected-text annotation is immediately available.
- Decision reviews start in **Explore** mode so forms, links, and other artifact controls work immediately.
- An invoking workflow can explicitly select the other initial mode without changing the review purpose.
  Spec module-sketch approval reviews use **Explore** mode.

The user can switch modes at any time.
Use `<document title> - <document intent>` for the HTML `<title>` so the browser tab identifies both the subject and why the document exists, such as `Overnight Runner - Spec`, `Overnight Runner - Tasks`, or `Overnight Runner - Review Findings`.
Use the actual document intent rather than copying an example label.

## Canonical artifact contract

The HTML file itself is the durable source consumed and updated by later phases.
Do not create a Markdown companion or duplicate hidden JSON model.
Use ordinary semantic HTML plus only the narrow metadata automation needs.
For task artifacts, identify each slice and acceptance criterion with stable `data-*` attributes for status, mode, dependencies, and story coverage.

The review runtime injects its browser bridge only into the served response.
It never rewrites the saved artifact merely to add review controls.

### Disposable module-sketch artifacts

The Spec workflow may generate a temporary HTML review surface when its sketch has more than four modules.
Keep it in the operating-system temporary directory, with no Markdown companion or hidden data model.
It is not durable Authoritative intent: the workflow carries the accepted sketch into the canonical Spec.
Use one bounded card per module and a final instruction that says exactly how the user approves the checkpoint.
Update the same file for feedback within the checkpoint.

## Plain-language contract

Write every reviewer-facing heading, label, explanation, and instruction in plain language.
Prefer the project's ubiquitous language from the selected context documentation, followed by common technical terms the user is likely to know.
Do not expose internal workflow names, machine values, payload fields, or specialist jargon as the main label when a familiar phrase says the same thing.
Keep exact machine values in safe metadata or generated submissions rather than making the reviewer translate them.

## Review loop

1. Generate the canonical HTML file with the required document title.
2. Load the `review-artifact` skill and open that file with its declared `feedback`, `approval`, or `decision` purpose.
3. Run its foreground poll immediately.
4. Repair every returned severe layout warning before inviting human review.
5. When feedback arrives, address every annotation and message in the canonical HTML.
6. Save the updated HTML so the existing browser session live-reloads it.
7. Poll again with a concise agent reply describing what changed.
8. If the poll returns `waiting` with a renewal instruction, immediately poll again in the same turn.
9. Repeat until the user explicitly approves or ends the session.

Feedback targets include a selector, nearby text, and text-range anchors when the user selected text.
Use the compact DOM snapshot only as supporting context; the canonical HTML remains authoritative.

## Artifact-owned forms

When an invoking workflow defines a decision form inside its artifact, a static artifact script may send one validated `review:submit` frame message containing a bounded prompt.
Put the submission fields inside the frame message's `prompt` object rather than beside it:

```js
window.parent.postMessage({
  type: "review:submit",
  completion: approvesWorkflowDecision ? "approve" : "end",
  prompt: {
    prompt: JSON.stringify(validatedPayload),
    selector: "#decision-form",
    tag: "workflow-decisions",
    text: "Submitted decisions",
  },
}, "*");
```

The review shell queues that prompt and immediately sends it through the normal foreground feedback path, so the user never copies an internal payload into chat.
Treat all artifact form values as untrusted input and build submissions from current native form controls without dynamic code interpolation.
The frame may set `completion` to `approve` only when the form validates a workflow-defined approval decision; use `end` for every submitted non-approval decision.
The shell sends the prompt and terminal action together, then shows the same completed-review splash screen as its Approve or End review control.
If an older artifact omits `completion`, fail closed to an unapproved end.
A materially changed artifact can start a new review with `--reopen` after a prior form submission ended its session.

## Decision semantics

An `approved` event from the shell's Approve control or a validated approval form submission is explicit approval and clears the invoking workflow's current gate.
An `ended` event from End review or a submitted non-approval decision stops browser polling without approval.
Closing the browser, disconnecting, or interrupting a poll is not approval.
Do not ask for a second confirmation after `approved` arrives.

If the user approves in harness chat while a browser session is active, accept that approval and end the browser session as the agent.

## Live synchronization

Unlike the retired Markdown-companion workflow, regenerate or edit the canonical HTML after every feedback batch.
The open review must show the current artifact rather than intentionally lagging until the end.
Preserve stable section and task identifiers so existing feedback remains understandable across reloads.

## Resilience

If the browser runtime cannot start, fall back to chat and preserve explicit approval semantics.
Report the fallback rather than silently skipping review.
A foreground poll uses bounded leases so the harness command finishes normally before its fixed wall-clock timeout.
A `waiting` result with a renewal instruction is normal and must start the next foreground poll immediately.
If a foreground poll is interrupted, rerun it because queued feedback and terminal decisions remain durable.
Never background the poll without a harness-native completion path that is guaranteed to resume the same agent turn.
