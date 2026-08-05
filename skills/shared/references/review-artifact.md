# Review Artifact Protocol

Shared protocol for any skill that presents an HTML artifact to request feedback, a decision, or approval.
The invoking skill generates the canonical semantic HTML; `review-artifact` owns only the browser feedback loop.

## When it applies

Use `review-artifact` whenever the next user action is to inspect an HTML file and respond about its contents.
Examples include approving a spec, refining tasks, or choosing whether to act on an architectural review finding.
Do not start a review session for HTML that is only being displayed for information with no response requested.

## Canonical artifact contract

The HTML file itself is the durable source consumed and updated by later phases.
Do not create a Markdown companion or duplicate hidden JSON model.
Use ordinary semantic HTML plus only the narrow metadata automation needs.
For task artifacts, identify each slice and acceptance criterion with stable `data-*` attributes for status, mode, dependencies, and story coverage.

The review runtime injects its browser bridge only into the served response.
It never rewrites the saved artifact merely to add review controls.

## Plain-language contract

Write every reviewer-facing heading, label, explanation, and instruction in plain language.
Prefer the project's ubiquitous language recorded in `CONTEXT.md`, followed by common technical terms the user is likely to know.
Do not expose internal workflow names, machine values, payload fields, or specialist jargon as the main label when a familiar phrase says the same thing.
When an uncommon technical term is unavoidable, define it beside its first use in one short sentence.
Keep exact machine values in safe metadata or generated submissions rather than making the reviewer translate them.

## Review loop

1. Generate the canonical HTML file.
2. Load the `review-artifact` skill and open that file with its runtime.
3. Run its foreground poll immediately.
4. Repair every returned severe layout warning before inviting human review.
5. When feedback arrives, address every annotation and message in the canonical HTML.
6. Save the updated HTML so the existing browser session live-reloads it.
7. Poll again with a concise agent reply describing what changed.
8. Repeat until the user explicitly approves or ends the session.

Feedback targets include a selector, nearby text, and text-range anchors when the user selected text.
Use the compact DOM snapshot only as supporting context; the canonical HTML remains authoritative.

## Artifact-owned forms

When an invoking workflow defines a decision form inside its artifact, a static artifact script may send one validated `review:submit` frame message containing a bounded prompt.
The review shell queues that prompt and immediately sends it through the normal foreground feedback path, so the user never copies an internal payload into chat.
Treat all artifact form values as untrusted input and build submissions from current native form controls without dynamic code interpolation.
An artifact form can submit feedback but cannot approve or end its own review.

## Decision semantics

An `approved` event is explicit approval and clears the invoking workflow's current gate.
An `ended` event stops browser polling without approval.
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
If a foreground poll is interrupted, rerun it because queued feedback and terminal decisions remain durable.
Never background the poll without a harness-native completion path that is guaranteed to resume the same agent turn.
