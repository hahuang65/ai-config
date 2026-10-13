# Artifact review

A standalone Rust executable for browser review of one local HTML file.
The runtime does not import the original review runtime, Node.js, or Pi.
The root `ai-config` installer owns the `.local/bin/artifact-review` link to this Rust executable.

## Build and commands

Use the mise-managed Rust 1.99 toolchain.

```sh
cargo build --manifest-path tools/artifact-review/Cargo.toml --locked
./tools/artifact-review/target/debug/artifact-review --help
./tools/artifact-review/target/debug/artifact-review open /absolute/document.html
./tools/artifact-review/target/debug/artifact-review poll /absolute/document.html --cursor 0 --timeout 20
./tools/artifact-review/target/debug/artifact-review poll /absolute/document.html --cursor 12 --timeout 20 \
  --reply 'Updated the wording.' --id 01234567-89ab-cdef-0123-456789abcdef
./tools/artifact-review/target/debug/artifact-review stop /absolute/document.html
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

`poll` waits in the foreground for at most 0–60 seconds, plus a bounded local request timeout of 3 seconds.
Its default wait is 20 seconds.
It returns `events`, `cursor`, `status`, `more`, `approved_revision`, `current_revision`, and `needs_review`.
`approved_revision` is null unless the current review outcome is approval.
`current_revision` binds the current HTML and any displayed render bytes, or is null when the artifact or a referenced local render cannot be read safely.
`needs_review` is true when the current bytes do not have approval, including when the file is unreadable.
These fields are returned even when there are no new events; checking them does not append an event.
The default cursor is 0, which replays history.
Pages contain at most 50 events; use the returned cursor to continue while `more` is true.
Save the cursor only after processing the returned events.
Interrupted waits do not consume events; retry with the last processed cursor.
Empty events with `status: "open"` mean no feedback arrived, not approval.
A reply requires a caller-generated stable ID of 16–80 letters, digits, or hyphens.
Retry an interrupted reply with the same ID and content.
Reusing an ID for different content is rejected.

## Browser behavior

The shell keeps the document beside a feedback panel, with a stacked layout on narrow screens.
Click an element or select text to write an annotation.
Add annotations to the queue, write general feedback, and use **Send feedback**, **Approve**, or **Decline**.
All three actions include unsent annotation comments and general feedback.
Send feedback keeps the review open.
Decline ends it without approval.
Closing the tab, losing the connection, stopping the server, and timing out are not approval or decline.

The shell polls for live document updates and agent replies.
Submitted annotations remain in the conversation even if their target changes or disappears.
Each annotation retains its original target text, selector, and revision.
Unsent drafts and the exact pending submission are kept in that tab's session storage.
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
Local PNG, JPEG, WebP, and GIF renders in the HTML directory (including plain relative subpaths) and embedded base64 images of those types are copied into the inert snapshot.
Referenced local paths must stay inside that directory without symlinks; a missing, unsupported, malformed, or oversized local render prevents approval rather than showing an incomplete design.
Each render is limited to 2 MiB, with at most 24 images and 8 MiB of decoded image bytes per snapshot.
External CSS, fonts, remote images, SVG, unsupported markup, and interactive artifact behavior are not supported.
Remote images are stripped and never fetched; do not request approval of image-dependent work unless the required renders are visible.
This is a review of static self-contained HTML, not a general browser preview.
Feedback and target text are rendered through `textContent`, never interpreted as HTML.
The shell does not accept artifact `postMessage` decision messages.

Files are limited to 2 MiB of UTF-8 HTML.
Requests are limited to 128 KiB and a 5-second server timeout.
Each submission permits 8000 UTF-8 bytes of general feedback and 16 annotations.
Each annotation permits 4000 bytes of comment, 2000 bytes of target text, and 1000 bytes of selector.
History is capped at 10,000 events; reaching the cap refuses new events without deleting old ones.
There is no automatic history pruning or opaque history rewrite.

Storage defaults to this evaluation's `.state/reviews`, resolved from the crate's build-time project location.
Set `AR_ROOT` to a private directory for isolated tests or an explicitly relocated installation.
Each file path, with its parent directory canonicalized and its final filename unchanged, maps to a SHA-256 directory with mode 0700.
Replacing the final file with a symlink does not change session identity: `poll` and `stop` still reach the original session.
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
The default Firefox path is `/Applications/Firefox.app/Contents/MacOS/firefox`.
Set `FIREFOX_BIN` to an installed Firefox executable on other systems.
Node.js 25 supplies the test runner and WebSocket client only; it is not a runtime dependency.

```sh
cargo build --manifest-path tools/artifact-review/Cargo.toml --locked
node --test --test-concurrency=1 tools/artifact-review/tests/integration.mjs
```

Coverage includes process-level cursor replay, interrupted waits, abrupt server restart, idempotent replies and submissions, authentication, origin checks, stale approval, current-versus-approved revisions, symlink replacement with retained history and shutdown, input limits, private storage, and CLI validation.
Real Firefox cases cover element and selected-text comments, general feedback, agent replies, live reload, retained annotations, response-loss retries, draft inclusion in terminal decisions, stale-page rejection, post-approval edit and reload, decline, closing without approval, class-based layout and styles, local render visibility, decode failures and revision binding, script isolation, text-only feedback rendering, and narrow layout.

## Attribution

The shell layout and Catppuccin palette are adapted from hhhuang's `ai/skills/review-artifact/runtime/assets/shell.css`.
The executable, shell logic, and bounded Firefox fixture are standalone implementations.
No source module from that runtime is imported.
