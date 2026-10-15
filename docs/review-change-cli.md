# Change review CLI

Build the Rust binaries with `make build`, then invoke `tools/evaluation/target/release/review-change-eval` (also linked at `~/.local/bin/review-change-eval` after approved package installation).
Neither review nor posting runs as part of the package installer.

```text
review-change-eval review local --repo DIR --intent TEXT --engine pi --json
review-change-eval review range BASE..HEAD --repo DIR --intent TEXT --engine pi --json
review-change-eval review pr https://github.com/OWNER/REPO/pull/NUMBER --repo DIR --intent TEXT --engine pi --json
review-change-eval post /absolute/report.html [--state-dir DIR]
```

The reviewed repository must be explicit and the review intent must describe its intended behavior.
`local` compares HEAD to the working state; `range` compares two committed endpoints.
`--path` limits evidence to a literal relative file or directory, never a glob.
The Rust command freezes bounded, eligible source evidence, rejects modified or missing evidence, then invokes a restricted reviewer that cannot edit, run source code, or publish.
Pi uses an ephemeral isolated profile with no ordinary extensions, skills, or project context and a link to existing authentication when present; Claude review is independently available with `--engine claude`.
Neither mode imports evaluation `.state/pi` or historical agentmemory data.

Retained private reports and signatures default to `~/.local/state/ai-config/change-reviews`.
`--state-dir` selects a separate private location, including when reviewing this source checkout.
JSON mode never opens a browser or posts.
A normal terminal review opens the escaped, self-contained HTML report in the ordinary browser.
The shared review-change skill separately opens artifact-review's finding mode when collecting repair decisions; the CLI does not start that feedback loop itself.
The report states successful file reads, exclusions, uncertainty, and that tests were not run by the restricted reviewer.

## Finding decisions and repairs

Use the exact retained paths returned by review JSON:

```text
artifact-review open /absolute/report.html --findings /absolute/report.json
artifact-review wait /absolute/report.html --cursor 0
```

Each rendered finding card contains its own Accept and Reject controls.
The review sidebar holds element/selected-text annotations, general feedback, and conversation; the saved report remains unchanged.
Accept saves immediate authorization to repair that finding; Reject and undecided findings authorize no repairs.
A click includes unsent comments and drafts, and interrupted submissions retry with the same ID.
Decisions cannot be silently replaced or reset by reopening the report.
End review and closing the browser do not undo earlier accepts or authorize undecided findings.
An explicit request in chat is needed to change a decision; already-performed repairs are not undone automatically.

The artifact-review process stores the bound finding list and decisions separately, leaving the retained HTML, JSON, and publication signatures unchanged.
`wait` keeps the foreground agent turn active without an inactivity cutoff; empty transport heartbeats do not return control to the model.
After interruption, resume with the same report and last processed cursor, without manufacturing a decision or reopening a terminal review.
`wait` and bounded `poll` return per-finding decisions under `finding_review`; its `needs_review` flag means the report revision changed or cannot be read, not that every finding has a decision.
Only a specific saved accept with matching event/current/bound revisions can authorize repair, and only when that flag is false.
Before mapping IDs to the retained record, verify its SHA-256 equals `finding_review.report_digest`.
The ordinary top-level `approved_revision` and `needs_review` fields are for whole-document approval, not finding decisions.
`status: "decided"` means all findings have decisions, including rejected ones; an empty report grants no repair authority.

The calling workflow checks source relevance, applies only accepted repairs within its ownership rules, avoids replaying already-applied repairs, and reruns verification and review.
Unrelated source changes require a fresh review; earlier authorized repairs in the same batch are explicit context, not a reason to transfer finding IDs to a new report.
Keep prior reports immutable and review the changed task into a new retained report with new decisions.
Informational reviews can still use the plain browser view, and an unavailable finding-review mode requires an explicit chat fallback rather than treating whole-report approval as repair authorization.
Neither finding decisions nor an all-decided report authorize staging, commits, installation, delivery, provider publication, or blanket approval of the code.

These local decisions share artifact-review's same-user trust boundary; they are not tamper-resistant proof against a program running as the same operating-system user.
They do not replace the separate human-terminal confirmation for posting.
See [artifact-review's contract](../tools/artifact-review/README.md#finding-review-mode) for bounds, persistence, and recovery.

## Reviewer failures

A zero process exit is not proof of completed review.
Pi's known non-success stop reasons distinguish model/API errors, model output limits, aborted requests, and unfinished tool work; unknown values are not echoed.
Runner diagnostics separately identify unsuccessful process exits, signals, timeouts, interruption, the 16 MiB event-stream limit, and the 64 KiB stderr limit.
Malformed or unverified completion evidence, including failure to read either `scope.json` or `patch.diff`, remains a failure, never a partial report.

On a runner or completion-validation failure, the change-review command exits 1 with empty stdout and prints a `Failure diagnostic: PATH` line on stderr.
The private review directory retains its frozen snapshot and a mode-600 `failure.json`, but no successful report, HTML, or publication signature.
The version-1 diagnostic contains only an allowlisted category, engine, known stop reason, and observed process metadata; unavailable exit, signal, or byte counts are null.
Counts describe captured bytes, capped at the relevant limit plus one, not the child's total output.
Timeout, interruption, and overflow diagnostics preserve observed counts, which can be partial, even when a pipe has not closed.
An already-observed exit status is preserved; forced cleanup does not supply an inferred exit status.
Raw stderr, provider error messages, model response text, prompts, and credentials are not included in the diagnostic.
A model/API category does not establish the provider's underlying cause; check authentication or provider availability without copying secrets into the report.
Failures before runner invocation or during findings-schema validation do not produce this diagnostic record.
No automatic retry, engine fallback, installation, or publication follows a failure.

## Retained reports and publication

Retained signatures bind report records and HTML bytes, but the signing key and records are accessible to programs running as the same operating-system user.
A same-user agent could change both, so the signature does **not** establish report integrity against that agent.
This is an accepted risk for the present human-reviewed workflow, not a claim of tamper resistance.
The human inspects the report, and posting pull-request findings separately requires an exact preview and confirmation in a human terminal.
That confirmation alone cannot establish that a saved report was never altered; revisit this risk if independent authenticity or posting without human review becomes necessary.

For GitHub pull requests, posting uses a separately selected, retained report; no review command grants posting authority.
Only the human runs `post REPORT` in an interactive terminal, confirms the exact preview, and sends comments (`COMMENT`, not `APPROVE` or `REQUEST_CHANGES`).
A failed or uncertain post must be reconciled from the same retained report, not bypassed with an independent request.
Read `review-change-eval --help` for current argument limits and error codes.
