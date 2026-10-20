# Artifact review

A standalone Rust executable for browser review of one local HTML file.
The runtime does not import the original review runtime, Node.js, or Pi.
The executable is named `review-artifact` and remains inside this package's build directory.
It has no installed shell PATH alias; harness skills resolve it from their absolute configuration source.

## Build and commands

Use the mise-managed Rust 1.99 toolchain.

```sh
cargo build --manifest-path tools/artifact-review/Cargo.toml --locked
./tools/artifact-review/target/debug/review-artifact --help
./tools/artifact-review/target/debug/review-artifact open /absolute/document.html
./tools/artifact-review/target/debug/review-artifact wait /absolute/document.html --cursor 0
./tools/artifact-review/target/debug/review-artifact wait /absolute/document.html --cursor 12 \
  --reply 'Updated the wording.' --id 01234567-89ab-cdef-0123-456789abcdef
./tools/artifact-review/target/debug/review-artifact stop /absolute/document.html
```

`open --no-browser` starts the tracked server without opening a browser or printing a secret URL.
Repeated `open` calls reuse the server.
Opening a closed review appends a new review event, without deleting earlier feedback.
`stop` stops only the server; it does not change the review outcome or remove history.
If a server crashes, `open` restarts it with a new capability and retains events.
Use `open` without `--no-browser` to open the new browser connection.

Each command returns one JSON object on standard output.
Errors go to standard error without capabilities or artifact contents.
Exit status 0 means command success, 1 means an operational failure, and 2 means invalid arguments.
A successful command does not itself mean approval.
`status` is the persisted review outcome, not approval of the current file.
`status: "approved"` and its persisted `approve` event identify approval of that event's `revision` only.
Treat the current file as approved only when `needs_review` is false: `current_revision` then matches `approved_revision`.
Later file changes are not approved by that event.

`wait` waits indefinitely in the foreground until saved feedback is available after the cursor or the review is terminal.
Silence never ends the logical wait or grants approval.
The server holds a request until a durable state change or a bounded transport heartbeat; the command renews empty waits internally, without returning control to the model.
Connection timeouts retry internally; other connection errors, server shutdown, cancellation, and harness execution limits interrupt the command without consuming history.
Resume an interrupted wait using the same report and last processed cursor; a stopped or incompatible server needs explicit recovery, not silent reopening of a terminal review.
The `wait` command itself does not wake an ended turn.
Native adapters provide the separate background delivery described below.

`poll` remains the bounded interface: 0–60 seconds, default 20, plus a bounded local request allowance of 3 seconds.
`poll --timeout 0` checks immediately.
Both commands return `events`, `cursor`, `status`, `more`, `approved_revision`, `current_revision`, and `needs_review`.
`approved_revision` is null unless the current review outcome is approval.
`current_revision` binds the current HTML and any displayed render bytes, or is null when the artifact or a referenced local render cannot be read safely.
`needs_review` is true when the current bytes do not have approval, including when the file is unreadable.
These fields are returned even when there are no new events; checking them does not append an event.
The default cursor is 0, which replays history.
Pages contain at most 50 events; use the returned cursor to continue while `more` is true.
Save the cursor only after processing the returned events.
Interrupted waits do not consume events; retry with the last processed cursor.
Empty events with `status: "open"` mean no feedback arrived, not approval.
An explicitly selected manual compatibility consumer keeps `wait` active while its review remains open.
Use no shell-tool timeout for that manual workflow when supported, and report interruptions honestly.
Ordinary agent-launched reviews instead return control and use native background delivery.
A reply requires a caller-generated stable ID of 16–80 letters, digits, or hyphens.
Retry an interrupted reply with the same ID and content.
Reusing an ID for different content is rejected.

## Background feedback

An `open` result includes an opaque five-minute attachment receipt, not the browser capability.
Pi and Claude adapters consume it and bind the artifact to the actual originating conversation and canonical workspace.
A receipt cannot redirect an already attached review to another conversation.
The review's private SQLite history queues feedback and decisions transactionally.
The shared private routing index permits up to 50 artifacts per origin.
A notification does not claim work or report Working while the conversation is busy elsewhere.
Unavailable artifacts, inboxes, and lease renewals are skipped individually so a healthy replacement can still deliver feedback.
The listener clears failed lease tracking and returns `skipped_unavailable: true` when it skips a review or renewal.
It never reopens the old server, restores failed work, or marks that work completed.
Shared routing-state errors still fail the listener rather than being hidden.

`attach`, `attached`, `focus`, `listen`, `claim`, `renew`, `finish`, `fail`, `active`, and `abandon` support the native adapters.
The native `focus` command records the current canonical workspace for a conversation.
Once tracked, an inactive workspace cannot notify or claim feedback, and CLI claims also require that workspace as their actual working directory.
Claims use new attempt tokens and renewable 60-second leases.
A lease owns one feedback event, not a worktree or session lock.
Interrupted attempts remain Needs attention, and a replacement attempt invalidates the old completion token.
Completion saves one idempotent reply and distinguishes Answered from changed artifact bytes.
Change-report wording updates use the owned `revise` command and retain the same artifact path.
Verified wording updates refresh decided and ended reports without reopening decisions or approval.

Pi queues native follow-ups and claims only when feedback reaches model context.
Claude uses native `asyncRewake` hooks and re-arms them after feedback or a 55-minute idle maintenance turn.
Maintenance can add visible activity and token usage, but grants no new task authority.
Synchronous SessionStart and completed EnterWorktree/ExitWorktree hooks record Claude's current workspace.
Unclaimed feedback waits while its originating workspace is inactive and becomes eligible again on re-entry.
A short synchronous Stop hook saves the reply before another user prompt can clear the claim.
An active listener renews its conversation's claimed leases while work continues.
Closing or interrupting a conversation retains feedback for its original saved conversation to resume.
Neither adapter substitutes another editing agent.

`open REPORT.html --findings REPORT.json --standalone` enables an on-demand read-only responder instead.
This mode has no repair Accept/Reject controls, including for local and range reports.
PR publication still uses the existing human-controlled fields and confirmation.
The detached server waits without an idle model and starts the retained restricted engine only for feedback.
Responder settings and frozen-evidence fingerprints remain signed and separate from current report wording.
The responder reads a private verified copy, the retained review, current feedback, and bounded prior discussion.
Snapshot copying permits 128 MiB, 20,000 entries, depth 64, and 16 MiB per file, with no symlinks.
Discussion context contains at most 50 prior events within a 128 KiB total feedback bound, with explicit truncation metadata.
The responder cannot edit source, execute it, publish, or change authentication settings.
Failures retain feedback without an automatic job retry or engine fallback.
The browser's Retry response button explicitly requeues one failed standalone response with a new attempt token.
It grants no source-repair or publication authority.
Failed reports can instead be regenerated; draft recovery is not a requirement.

`/processing` and the event page expose Queued, Working, Answered, Updated, and Needs attention through the shared submission banner.
Approval and publication remain separate and keep their stronger status precedence.
Processing-state changes do not submit unsent annotations or publication drafts.
A wording update can discard unconfirmed drafts and selections.
Report updates use atomic file replacements without a recovery journal or crash replay.
If interruption leaves an invalid report, generate another report.

## Finding-review mode

```sh
./tools/artifact-review/target/debug/review-artifact open /absolute/report.html \
  --findings /absolute/report.json
```

This explicit mode imports the retained version-1 change-review record, not arbitrary decision markup embedded in HTML.
It requires a matching HTML digest, at most 50 sequential F1–F50 finding IDs, and titles of 1–500 UTF-8 bytes using the change-review title contract.
The record must be a regular, non-symlink UTF-8 JSON file no larger than 25 MiB.
Malformed or mismatched input is refused before starting a server; revision checks repeat at configuration and decision time.
The private SQLite configuration stores the fixed IDs/titles, bound HTML revision, SHA-256 of the exact input record, and whether it is publication-only PR mode.
It does not modify the retained HTML, JSON, or publication signatures.
No installed resources or dependencies are added by this mode.

In finding-review mode, the browser title and toolbar say Change review, without harness branding.
Local reports replace whole-document Approve with Accept/Reject buttons inside each corresponding rendered finding card.
Each local finding also has an optional decision-comment field, saved only with that finding's Accept or Reject decision.
Other findings' comments remain separate drafts, including when sending ordinary feedback or ending the review.
Comments are stored in the decision event's existing `message`; when general feedback is also present, labeled sections distinguish it from the finding comment.
The sidebar remains for annotations, general feedback, and conversation.
The parent review runtime adds these controls after loading the inert snapshot, without enabling document scripts or changing the saved report.
Missing or ambiguous finding anchors disable decisions rather than attaching controls to the wrong content.
Accept immediately authorizes repair of that finding; Reject and undecided findings authorize nothing.
Each decision includes drafts and saves an `accept` or `reject` event containing `finding`, `revision`, message, and annotations.
Only the human chooses decisions; agent workflows must not manufacture these events.
An exact retry returns the original cursor, even after restart or completion.
A different payload with the same submission ID is refused, as is a second decision for an already-decided finding.
Explicit chat clarification is needed to change a decision; a later rejection cannot undo work already performed.

`wait` and `poll` add `finding_review` containing:

- `publication_only`: true for PR reports, which never authorize repairs or record new Accept/Reject decisions.
- `read_only`: true for standalone discussions, which cannot authorize source repairs.
- `revision`: the fixed report revision for this finding list.
- `report_digest`: SHA-256 of the exact imported JSON bytes, to verify before mapping IDs to repairs.
- `items`: ID, title, and `decision` (`accept`, `reject`, or null for undecided).
- `needs_review`: true when current artifact bytes differ from the bound report or cannot be read safely.

That nested flag describes revision validity, not whether every finding has been decided.
Only local reports with `read_only` false or absent, `publication_only` false, matching event/current/bound revisions, a false nested flag, and a saved accept authorize the corresponding repair.
The ordinary top-level approval fields still describe whole-document approval and remain independent.
For local reports, when every item has a decision, status becomes `decided`; this does not mean every finding was accepted or the code approved.
PR feedback remains open until End review, even with zero findings or after publication.
Zero findings produce no repair authority.
The server rejects whole-document approval in this mode and refuses decisions for unknown IDs, ordinary artifacts, closed reviews, or changed reports.
Missing/symlinked source files leave history available but cannot receive new decisions.

A legacy PR configuration can be enriched with publication-only metadata for the same exact digest, revision and finding list, never downgraded into local repair authority.
The original report and event payloads remain unchanged; historical PR decisions do not select comments or authorize repairs.
Restart an older tracked server with the new executable before using this mode, preserving its history.

End review closes the session without undoing saved local accepts.
Reopening preserves decisions and can resume undecided findings; completion never resets the list.
An existing ordinary review with feedback cannot be converted into finding authority.
A different record cannot replace a configured list at the same artifact path, even if the HTML digest happens to match.
Use a new retained report path for a fresh review after repairs; do not edit or re-sign the old report.
If a server from an older executable lacks this mode, report the error rather than silently falling back to whole-report approval.

The calling workflow owns source relevance checks, repair execution, cursor handling, and avoiding replayed repairs.
No finding decision authorizes commits, installation, delivery, or publication.
Same-user programs remain trusted: this local record is not proof against tampering by an agent with arbitrary same-user filesystem access.

## Publication confirmation

A signed retained PR report bound through `--findings` uses publication-only mode, not repair Accept/Reject or whole-document approval.
Each card gets an unchecked checkbox and prefilled editable comment from the finding explanation, without added internal finding-ID prefixes.
Only selected comments are sent, verbatim, to the finding's verified immutable file, side and line.
Unknown or unverified locations are disabled and rejected by the backend, never redirected into review-body comments.
The retained HTML and JSON remain unchanged.

The runtime appends one Publish button below the document, alongside the account, PR, available reviewed-revision details and publication status.
The visible editable comments and destinations are the confirmation view; there is no separate Preview button or second confirmation.
Only the human selects and edits comments and clicks Publish.
Edits and selection alone do not publish, and the sidebar stays for feedback with the agent.
Send feedback and End review do not include or publish PR comment drafts.
The backend signs a preparation only after that click, verifies that the displayed account and revisions match, and rechecks the signed report, exact open PR scope and account before mutation.
Signed preparations expire after ten minutes and their count is bounded.
Local reports cannot publish, and an unavailable signature or mismatched record never falls back to unsigned publication.

The artifact executable links the existing evaluation library for locks, signed previews, attempts, receipts and reconciliation rather than invoking a retired publisher or adding a shell posting command.
A lost response leaves the persisted attempt uncertain; Check publication status reconciles that same attempt without a new POST.
An already-confirmed receipt remains posted across reloads and retries.
After publication, the app shows posted status instead of recreating editable default comments; the PR contains the actual submitted text.
Publication does not rewrite report wording or repair decisions.
Owned wording revisions preserve exact confirmed attempts and outcomes without another publication or authorization.
Publication requests require the same exact local origin and session capability as other mutations.
Models must not call these endpoints or manufacture human confirmations.
The capability/signature design does not cryptographically prove a human gesture against arbitrary same-user code.
Protected legacy publication state is never read or migrated.

## Browser behavior

The shell keeps the document beside a feedback panel, with a stacked layout on narrow screens.
Click an element or select text to write an annotation.
The selected target receives a visible outline, and a floating comment editor appears beside it rather than in the sidebar.
The outline and editor follow scrolling and resize within the visible document area; the editor flips or clamps near viewport edges.
Add annotation queues the comment and clears the selection; Cancel or Escape dismisses the unqueued draft.
General feedback and queued/submitted comments remain in the sidebar.
Use **Send feedback**, **Approve**, or **Decline** to submit the queued comments.
All three actions include unsent annotation comments and general feedback.
Send feedback keeps the review open.
Decline ends it without approval.
Closing the tab, losing the connection, stopping the server, and timing out are not approval or decline.

For an open review, the shell holds an event request for replies and decisions rather than repeatedly fetching history.
It separately checks `/revision` every 700 ms after each completed check, fetching `/snapshot` only when the displayed revision differs or has not loaded.
Tabs showing a closed review retain the previous bounded refresh behavior to observe reopening; no browser timer is an approval signal.
Submitted annotations remain in the conversation even if their target changes or disappears.
Each annotation retains its original target text, selector, and revision.
A restored element draft can highlight the same target only at the matching revision.
If its target is offscreen, a text range cannot be reconstructed, or the document revision changes, the draft is retained without pretending that a different target is selected; the editor explains the missing location.
Selection outlines and the floating editor are owned by the review runtime and never change saved artifact bytes.
Unsent drafts and the exact pending submission are kept in that tab's session storage.
Finding-comment drafts are keyed by the retained record digest and finding ID; acknowledging a decision clears only its own comment.
If a response is interrupted, **Retry submission** sends the same ID and content.
Server persistence precedes acknowledgement; retries do not create duplicate events.
Do not clear private browser storage while a submission is unconfirmed.
Unsent drafts are not guaranteed to survive closing the browser or moving to a new server origin.

Approval sends the revision assigned only after the iframe has loaded its snapshot and any retained raster images have decoded in the browser.
The server hashes the current file again before saving approval.
A stale revision or unreadable file is rejected without approval, and the draft remains available.
Approval records the HTML and displayed render bytes observed at that check; it cannot lock an external editor against later writes.
Changing a referenced render invalidates approval even if the HTML text is unchanged.
Material changes require another review.
A closed browser review keeps its loaded snapshot until the page is reloaded.
After a reload, the shell compares the displayed snapshot with the persisted approved revision and marks different bytes as not approved.
Use `open FILE` to start another review; a changed snapshot does not create a terminal event.

## Isolation and limits

The server binds only to `127.0.0.1`, on a random port.
A random 256-bit capability authorizes every state or artifact endpoint.
Only the static shell HTML, JavaScript, and CSS are public; they contain no artifact or capability.
Browser launch carries the capability in a URL fragment, which the shell removes from browser history and keeps in session storage.
Host validation blocks alternate hostnames, origin validation rejects foreign origins, and mutations require the exact local origin.
There is no CORS permission and no arbitrary local-file route.
Local processes running as the same user remain trusted.

The shell renders an Ammonia-sanitized inert `srcdoc` snapshot in an iframe with `sandbox="allow-same-origin"`, **without** `allow-scripts`.
Document scripts are intentionally disabled and removed.
Forms, links, embedded frames, and active content are removed or made inert.
Content Security Policy blocks external resources and navigation targets; the shell also cancels artifact clicks and form submission.
Inline CSS and class attributes are retained, including class-based layout and styles.
Document title metadata is removed from the snapshot rather than leaking as plain body text; visible headings and the original file's title remain unchanged.
Local PNG, JPEG, WebP, and GIF renders in the HTML directory (including plain relative subpaths) and embedded base64 images of those types are copied into the inert snapshot.
Referenced local paths must stay inside that directory without symlinks; a missing, unsupported, malformed, or oversized local render prevents approval rather than showing an incomplete design.
Each render is limited to 25 MiB, with at most 24 images and 25 MiB of decoded image bytes per snapshot.
External CSS, fonts, remote images, SVG, unsupported markup, and interactive artifact behavior are not supported.
Remote images are stripped and never fetched; do not request approval of image-dependent work unless the required renders are visible.
This is a review of static self-contained HTML, not a general browser preview.
Feedback and target text are rendered through `textContent`, never interpreted as HTML.
The shell does not accept artifact `postMessage` decision messages.

HTML and retained report JSON each have a 25 MiB limit.
Ordinary feedback requests are limited to 128 KiB and a 5-second server timeout.
Only publication preparation permits a 1 MiB body for up to 50 comments of 8000 UTF-8 bytes each; publication routes retain their separate 180-second transport budget.
Each submission permits an 8000-UTF-8-byte message and 16 annotations.
A finding comment permits 4000 UTF-8 bytes; its combined message with any general feedback and labels must fit the same 8000-byte bound.
Each annotation permits 4000 bytes of comment, 2000 bytes of target text, and 1000 bytes of selector.
History is capped at 10,000 events; reaching the cap refuses new events without deleting old ones.
There is no automatic history pruning or opaque history rewrite.

Storage defaults to this evaluation's `.state/reviews`, resolved from the crate's build-time project location.
Set `AR_ROOT` to a private directory for isolated tests or an explicitly relocated installation.
Each file path, with its parent directory canonicalized and its final filename unchanged, maps to a SHA-256 directory with mode 0700.
Replacing the final file with a symlink does not change session identity: `wait`, `poll`, and `stop` still reach the original session.
Artifact reads reject final symlinks and non-regular files.
Server records and event storage use mode 0600.
A per-file lock prevents duplicate server ownership.
SQLite transactions with full synchronization retain append-only feedback across process interruptions and server restarts.
The server record is replaceable derived state; the event database is not.
Do not share or publish the private server record.
The current executable supports Unix systems; browser launch uses `open` on macOS or `xdg-open` on Linux.

## Focused evidence

The process and browser suite is confined to this crate.
It uses disposable private storage, the compiled executable, and real headless Firefox through WebDriver BiDi.
There is no mock browser and no dependency on the original review runtime.
On Linux, Firefox is discovered as `firefox` on PATH; macOS defaults to `/Applications/Firefox.app/Contents/MacOS/firefox`.
Set `FIREFOX_BIN` to override either selection with an installed Firefox executable.
Node.js 25 supplies the test runner and WebSocket client only; it is not a runtime dependency.

```sh
cargo build --manifest-path tools/artifact-review/Cargo.toml --locked
node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs
```

Coverage includes process-level cursor replay, interrupted waits, abrupt server restart, idempotent replies and submissions, authentication, origin checks, stale approval, current-versus-approved revisions, symlink replacement with retained history and shutdown, input limits, private storage, and CLI validation.
Rust process tests in `tests/findings.rs` cover independent decisions, revision changes, ordinary-artifact separation, whole-report approval refusal, input bounds, persistence, and retries.
Real generated reports pass through the same bounded Firefox suite to exercise local Accept/Reject, decision comments, response-loss recovery, PR publication checkboxes and editable text, exact inline destinations, one final Publish action, draft reload, and unchanged report bytes.
PR process cases also verify publication-only mode, zero-finding feedback and preservation of legacy decision history without repair authority.
Real Firefox cases cover element and selected-text comments, general feedback, agent replies, live reload, retained annotations, response-loss retries, draft inclusion in terminal decisions, stale-page rejection, post-approval edit and reload, decline, closing without approval, class-based layout and styles, local render visibility, decode failures and revision binding, script isolation, text-only feedback rendering, and narrow layout.

## Waiting and render reuse

`/events?cursor=N&wait_ms=M` accepts one unsigned cursor and an optional wait of 0–30000 ms.
The server subscribes before checking the durable cursor, broadcasts after successful persistence, and releases waiters during shutdown.
Neither a dropped connection nor a missed notification loses history: the cursor remains authoritative and reconnects replay saved events.
Pages retain the 50-event bound and existing authorization/origin checks.
The event route permits its requested hold plus a five-second service allowance, capped at 35 seconds; immediate event reads and other routes retain their five-second deadline.
CLI requests use the requested hold plus three seconds, and browser event requests use the hold plus four seconds.
These transport budgets are not logical review inactivity limits.

Each process caches at most one successful rendered artifact, keyed by its absolute path and exact HTML bytes, with the 25 MiB HTML, 24-image, and 25 MiB decoded-image bounds.
Every revision check still reads the HTML and safely rereads, validates, and hashes the displayed image dependencies in their original order; size and modification time are never freshness proofs.
Unchanged HTML reuses the sanitizer-derived dependency list instead of parsing/sanitizing/encoding the full snapshot again.
A changed image requires a new render before its snapshot is served, while unchanged HTML and image bytes can reuse the previous inert snapshot.
A changed path or HTML replaces the single cache entry only after successful rendering.
Failures cannot authorize reuse: missing, symlinked, invalid, or oversized inputs still fail closed.
Approval and finding decisions always compute a fresh revision; neither outcomes nor current revisions are cached.
The revision algorithm and retained report bytes are unchanged.

Rust process tests in `tests/wait.rs` cover held requests, saved-event delivery, empty heartbeats, interruption/replay, shutdown, and byte-fresh revision checks.
The bounded browser case in `tests/live-wait.mjs` counts idle requests and exercises feedback, replies, and document refresh without duplicate history or repeated snapshot downloads.
See `test/timings.md` at the package root for measured local evidence and test watchdogs.

## Attribution

The shell layout and Catppuccin palette are adapted from hhhuang's `ai/skills/review-artifact/runtime/assets/shell.css`.
The executable, shell logic, and bounded Firefox fixture are standalone implementations.
No source module from that runtime is imported.
