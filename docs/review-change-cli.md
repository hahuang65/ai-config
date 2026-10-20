# Change review CLI

Build the Rust binaries with `make build`, then invoke `tools/evaluation/target/release/review-change` (also linked at `~/.local/bin/review-change` after approved package installation).
Neither review nor posting runs as part of the package installer.

For humans, use one optional subject:

```text
review-change https://github.com/OWNER/REPO/pull/123
review-change feature-branch
review-change worktree-name
review-change https://github.com/OWNER/REPO/tree/feature-branch
review-change 'X..Y'
review-change
```

No subject reviews the current branch plus staged, unstaged and non-ignored untracked files from the merge base with trunk.
Trunk comes from remote default metadata (origin preferred), then an unambiguous local main/master; ambiguity fails with a correction instead of guessing.
An exact branch takes precedence over a worktree-name match.
A selected registered worktree includes its outstanding changes, while an unchecked-out branch uses committed changes only.
A worktree whose branch or HEAD changes during selection is refused.
An explicit `X..Y` range uses Git revision expressions and exact endpoints, including omitted endpoints defaulting to HEAD; three-dot ranges are not supported.
PR URLs use the provider's exact declared base/head and their unique merge base.
GitHub branch and repository URLs use that repository's default branch, independently of the invocation directory.
Missing GitHub objects are fetched only into an unmaterialized private temporary repository, bounded to 256 commits of history and the normal Git command timeout; insufficient history fails explicitly.
Development refs, index and worktree files are never changed by target resolution.

There is no menu, manual intent form, report list, or report-ID navigation in the human interface.
Human reviews collect bounded PR descriptions and up to 20 commit messages as unverified context, not explicit acceptance criteria.
`--intent TEXT` can supply explicit acceptance context when available.
The existing `review local`, `review range X..Y`, and `review pr URL` forms remain compatible for agents, requiring their explicit `--intent`; `review local` still means HEAD to working state.
Use an absolute `--repo DIR` and explicit engine in agent workflows, and `--json` for the stable receipt without opening a browser.
`--path` limits evidence to a literal relative file or directory, never a glob.
The Rust command freezes eligible source evidence, rejects modified or missing evidence, then invokes a restricted reviewer that cannot edit, run source code, or publish.
Snapshots have no fixed file-count or content-size cap.
Privacy exclusions, independent command-output bounds, and process timeouts still apply.
Pi uses an ephemeral isolated profile with no ordinary extensions, skills, or project context and a link to existing authentication when present; Claude review is independently available with `--engine claude`.
Neither mode imports evaluation `.state/pi` or historical agentmemory data.

Retained private reports and signatures default to `~/.local/state/ai-config/change-reviews`.
`--state-dir` selects a separate private location, including when reviewing this source checkout.
JSON mode never opens a browser or posts.

### Terminal progress

Human CLI runs keep a running log on stderr while stdout retains the final report summary.
Each step logs local start and end times (`HH:MM:SS`) and elapsed seconds measured with a monotonic clock.
Failed steps log FAIL, and optional steps log SKIP instead of claiming work ran.
An interactive terminal also shows a live overall bar, the current stage, and total elapsed time.
The bar counts seven workflow stages, including skipped optional stages, not a percentage of model analysis or an estimated finish time.
Redirected stderr uses plain timestamped logs and a final total, without terminal control sequences.
Stages cover target resolution, source freezing, PR-location verification when applicable, the restricted reviewer, findings validation, report saving, and browser opening.
During the reviewer stage, successful native read events report snapshot-relative file names and a count of distinct evidence files inspected.
Both Pi and Claude use their own stream validators; failed reads, source contents, model text, and provider diagnostics are never progress output.
Read activity is not proof that the overall review completed successfully.
Every five seconds without completion, a WAIT entry shows the read count and elapsed reviewer time.
The overall bar continues to show total review time, including source preparation and browser opening.
The first 50 file names are shown, with individual names limited to 160 characters; later activity uses count summaries and points to the full `files_read` list in `report.json`.
Live event decoding is bounded and best-effort; the existing full-stream and completion checks still decide whether a report can be retained.
`--json` suppresses all progress messages and keeps its single JSON receipt.
A human review opens the escaped, self-contained HTML report in `review-artifact` with its matching finding record.
`--no-browser` retains and prints the report without opening it.
The shared review-change skill also opens finding mode explicitly for JSON/agent workflows.
The report is titled Change review, independently of the harness that started it.
Scope shows the repository name and a named comparison rather than local paths, full revisions, or snapshot hashes.
Branch/worktree names are used where available; PRs are identified by number and unnamed commits use shortened IDs.
Its short plain-language intent summary omits implementation detail, test logs, and work-log history, without discarding that context from the review.
Inferred purpose remains labeled as inferred.
The report summarizes evidence reads and retains uncertainty, exclusions, and the warning that tests were not run by the restricted reviewer.
Exact revisions, the snapshot digest, original intent context, and the full file-read list remain in the machine-readable record.
New findings have four distinct sections: User-facing problem, Why it matters, Technical details, and Suggested fix.
Reviewer responses supply a nonempty `intent_summary` of at most 600 UTF-8 bytes and `explanation` with nonempty `problem`, `impact`, `technical_details`, and `suggested_fix` strings.
New retained records also keep a Markdown `body` composed from those sections, with bold section headings for publication.
The record's optional `display` and `intent_summary` fields preserve those human-facing labels alongside the exact scope.
Existing version-1 body-only reports remain supported without being rewritten or inventing missing explanations.

## Standalone and agent-launched feedback

Outside an agent conversation, the CLI opens a read-only review and exits after initial generation.
Browser feedback starts a short-lived restricted responder using retained model options and verified frozen evidence.
An idle review makes no model call and needs no conversation maintenance turns.
The responder can discuss, clarify, and reword the review, never change underlying source, execute reviewed code, or publish.
Local, range, and PR targets share this source-read-only rule.

A CLI run inside Pi or Claude is agent-launched even when it uses the human-facing subject syntax.
Its opaque artifact receipt returns feedback to the originating conversation instead of starting another responder.
The Pi adapter supplies a session-scoped launch marker, while Claude supplies its native `CLAUDECODE` marker.
These markers select delivery mode, not repair or publication permission.
The native adapter still binds the exact conversation and workspace.
JSON mode continues to return retained paths without opening a browser.

## Agent-launched finding decisions and repairs

Use the exact retained paths returned by review JSON:

```text
tools/artifact-review/target/release/review-artifact open /absolute/report.html --findings /absolute/report.json
```

`review-artifact` is a source-local helper, not a shell PATH command.
Resolve the executable from the installed configuration source before invoking it.
The record selects local repair mode or PR publication-only mode.
The repair-decision rules below apply only to local reports; PR comments use the publication workflow described later.
Each rendered local finding card contains its own Accept and Reject controls and an optional decision-comment field.
Only that finding's comment accompanies its decision; comments on other findings remain drafts.
The decision event's existing `message` contains the comment, with labeled sections when general feedback is also included.
The browser can retain same-tab drafts, but draft preservation is not a requirement.
Unconfirmed drafts may be discarded after a wording update or failure.
A comment alone is not a decision or repair authority.
The review sidebar holds element/selected-text annotations, general feedback, and conversation; the saved report remains unchanged.
Accept saves immediate authorization to repair that finding; Reject and undecided findings authorize no repairs.
A click includes unsent comments and drafts, and interrupted submissions retry with the same ID.
Decisions cannot be silently replaced or reset by reopening the report.
End review and closing the browser do not undo earlier accepts or authorize undecided findings.
An explicit request in chat is needed to change a decision; already-performed repairs are not undone automatically.

The artifact-review process stores the bound finding list and decisions separately, leaving the retained HTML, JSON, and publication signatures unchanged.
Native adapters deliver feedback in the background and save the completed response in the browser.
A busy agent finishes its current request before claiming feedback.
After interruption, resume the originating conversation and inspect partial work before retrying.
The legacy `wait` interface remains available for an explicitly chosen manual compatibility workflow.
`wait` and bounded `poll` return per-finding decisions under `finding_review`; its `needs_review` flag means the report revision changed or cannot be read, not that every finding has a decision.
`finding_review.publication_only` is true for PR reports: selections and historical Accept/Reject entries never authorize repairs.
Only a specific local saved accept with matching event/current/bound revisions can authorize repair.
`publication_only`, `read_only`, and nested `needs_review` must all be false or, for the optional `read_only` field, absent.
Before mapping IDs to the retained record, verify its SHA-256 equals `finding_review.report_digest`.
The ordinary top-level `approved_revision` and `needs_review` fields are for whole-document approval, not finding decisions.
For local reports, `status: "decided"` means all findings have decisions, including rejected ones; an empty report grants no repair authority.
PR feedback stays open until End review, including after publication or when there are no findings.

The calling workflow checks source relevance, applies only accepted repairs within its ownership rules, avoids replaying already-applied repairs, and reruns verification and review.
Unrelated source changes require a fresh review; earlier authorized repairs in the same batch are explicit context, not a reason to transfer finding IDs to a new report.
Requested wording changes update the current report through the owned `revise` interface, without copies of earlier reports.
HTML and report JSON each have a 25 MiB bound, as do individual renders and aggregate decoded renders.
Updates use atomic file replacements without a recovery journal or automatic crash replay.
A failed or invalid report can be regenerated instead of recovered.
Saved finding authorizations retain their original finding and source scope, and publication attempts retain their exact confirmed payload.
Routine wording updates and retries do not require another authorization.
Review genuinely changed source into a new report with decisions for that new scope.
Informational reviews can still use the plain browser view, and an unavailable finding-review mode requires an explicit chat fallback rather than treating whole-report approval as repair authorization.
Neither finding decisions nor an all-decided report authorize staging, commits, installation, delivery, provider publication, or blanket approval of the code.

These local decisions share artifact-review's same-user trust boundary; they are not tamper-resistant proof against a program running as the same operating-system user.
They do not authorize the separate human Publish action for PR comments.
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
PR reports never offer repair decisions.
The runtime adds unchecked checkboxes and prefilled editable comments inside their finding cards, and one Publish button below the document.
The sidebar remains for agent feedback.
The existing PR URL in Scope and intent is a normal clickable anchor that opens GitHub in a separate tab without leaving the report.
The link does not depend on publication readiness or live GitHub checks.
The initial comment text is the finding explanation without added internal IDs; selected final text is sent verbatim to the verified file, side and line.
Unverified locations cannot be selected or fall back to summary comments.
Edits and selections alone never publish.
The visible text, destinations, account, PR and available reviewed-revision details form the confirmation view; there is no separate Preview step.
Publish is the final explicit human confirmation of that exact set.
The backend still signs a short-lived preparation, expiring after ten minutes, and checks the displayed account and revisions before accepting it.
The backend verifies the signed report, bound revision and record digest, then rechecks the account and exact open PR scope before mutation.
The local capability and signing key cannot establish that arbitrary same-user code did not simulate a browser gesture; no tamper-resistant human-presence guarantee is claimed.

For GitHub pull requests, posting uses a separately selected, retained report; no review command grants posting authority.
Only the human selects and confirms publication in the report; model tools must not invoke publication endpoints or manufacture that confirmation.
Publication sends comments (`COMMENT`, not `APPROVE` or `REQUEST_CHANGES`), never repair authority.
Each selected comment permits 8000 UTF-8 bytes, up to 50 comments, with a 1 MiB preparation-request bound; feedback retains its existing smaller request bound.
Drafts are kept separately by record digest and finding ID, not populated from old repair decisions.
After publication, the report shows posted status rather than recreating editable defaults.
A prominent banner above the readable document and a browser-tab title prefix distinguish submitted feedback, completed reviews, and confirmed publication.
Submitted feedback keeps the review open for follow-up; an agent reply is shown separately, and changed document bytes are marked as an updated version.
Approval, End review, and all-decided local reports show completion without granting additional authority.
Changed reports and uncertain publication outcomes show warnings instead of a current successful completion.
Loading or unavailable publication checks never imply completion, even after End review.
A changed PR report also retains explicit unresolved-publication guidance: do not resubmit before reconciling any existing attempt from the original unchanged report.
A legacy PR binding can be enriched with publication-only metadata for the same exact record without rewriting history; restart older tracked servers before reopening with the new executable.
A failed or uncertain post must be reconciled from the same retained report using Check publication status, not bypassed with an independent request.
A persisted attempt is never resubmitted; the existing per-report lock and receipt make replay and concurrent confirmation safe.
Closing the tab does not publish or stop the tracked server; stopping that server makes its browser controls unavailable until it is reopened.
The old explicit terminal `post REPORT` operation remains unadvertised compatibility for retained reports and consumers, not a required human step.
Read `review-change --help` for current argument limits and error codes.
The CLI rename preserves retained report formats, store ownership, and publication markers so existing reports can still be reconciled; those internal identifiers are not additional executables.
