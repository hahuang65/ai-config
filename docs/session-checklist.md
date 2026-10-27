# Session checklists

A session checklist shows progress within the current authorized task.
It is not Worklog, a backlog, a scheduler, or an approval record.
Worklog keeps cross-session reminders and meaningful history; do not log every checklist edit there or start queued reminders automatically.

Use checklists for meaningful multi-step work, chiefly implementation and planning.
Longer investigations, specifications, and conflict resolution can use them when helpful.
In coaching, track only the agreed current cycle and necessary checks, never speculative tests or inferred user readiness.
Keep the authoritative plan or specification where its workflow requires it; the checklist is only a progress display.
Prefer available native task-list tools, otherwise a concise list in ordinary chat.
Claude's conditional native task tools remain host-owned; this package does not add a second Claude tracker or force their availability.

## Pi interface

The owned [adapter](../harnesses/pi/todo.ts) registers the model-only, sequential `todo` tool and read-only `/todos` command.
It installs as `~/.pi/agent/extensions/todo.ts` from the generated bundle.
Read existing progress before replacing it:

```json
{"action":"read"}
```

A write atomically replaces the whole current checklist:

```json
{
  "action": "write",
  "title": "Add a repository adapter",
  "items": [
    {"id":"inspect","text":"Inspect existing behavior","status":"completed"},
    {"id":"implement","text":"Implement one tested behavior","status":"in_progress"},
    {"id":"verify","text":"Run checks and change review","status":"pending"}
  ]
}
```

Writes require a nonblank title and the complete items array.
Limits are 24 items, 160 title units, 40 ID units, and 240 text units, measured as JavaScript string lengths.
IDs are unique ASCII letters/digits/underscores/hyphens, starting with a letter or digit; they are not Worklog IDs.
Statuses are `pending`, `in_progress`, and `completed`, with at most one active step.
Invalid replacements leave the prior snapshot unchanged.
Use an empty items array to clear the display; a new task starts only through an authorized request.
When that request starts a different task, write a fresh title and complete items array instead of carrying over old steps.
The new snapshot replaces the previous task's checklist, not Worklog history.
The adapter does not infer task changes from conversation text.
Checklist status is model-reported progress, not proof that tests ran or permission to take another action.

Results carry `status: "ok"`, `"error"`, or `"cancelled"`, plus the version-one `checklist` snapshot in JSON text, `details`, and `structuredContent`.
Errors also set `isError` and include a fixed error message, never private exception details.
An empty snapshot in an error response means state was unavailable, not that stored progress was cleared.
Aborted calls do not replace state.
A persistence error can be uncertain: read before retrying rather than assuming a failed append changed nothing.

## Persistence and presentation

[State handling](../harnesses/pi/checklist/state.ts) uses Pi's current session branch and versioned `ai-config.session-checklist` custom entries.
Every accepted replacement records a complete snapshot through the native session API, not a separate repository file or state service.
Reads do not write entries, and state is reconstructed rather than cached across sessions or branches.
Reload, resume, tree navigation, compaction, and native worktree carry use the selected branch, never abandoned progress or another session's list.
Malformed latest snapshots return an error instead of silently replaying older state; an explicit valid write can recover the list.
Unrelated todo formats are not adopted.

The [view](../harnesses/pi/checklist/view.ts) stays above the editor with at most six width-safe lines.
It shows active and pending steps first, then folds completed steps into a separate `Completed: N — /todos` summary.
The compact view shows up to four ongoing rows, or three when the completed summary needs space, plus an overflow hint when needed.
`/todos` expands the ongoing task into Active and upcoming and Completed sections without changing saved progress.
A checklist with no ongoing steps hides from both displays, including after reload.
Its snapshot remains in normal session history until a new task replaces the current checklist.
There is no age threshold or separate Worklog todos screen.
RPC receives plain widget lines rather than TUI factories; clients may ignore that presentation.
Headless sessions still expose structured read/write results without UI calls.
UI failures do not undo or misreport a saved snapshot.
A deferred repaint failure produces an empty widget for that paint; a later successful repaint can show the saved checklist again.
Notification failures are contained separately from read failures; only an invalid stored snapshot leads to replacement advice.
Terminal controls and bidirectional overrides cannot execute or reshape task text in the display.

There are no dependency graphs, owners, arbitrary metadata, automatic next-task selection, hotkeys, extra configuration files, or third-party todo dependencies.
Normal resource discovery, independent integrations, artifact approval, finding decisions, coaching ownership, and commit/install/delivery/publication authority remain unchanged.
Do not put credentials or sensitive customer data in checklist text: it remains in the normal conversation/session record.

## Verification

`test/package-pi-checklist.test.ts` uses the installed Pi SDK and Node loader with disposable sessions, synthetic model responses, schema checks, and controlled UI bindings.
It verifies data operations, bounds, branch replay, native reload/compaction/resume, aborts, terminal safety, UI failure, and RPC/headless presentation contracts.
It also checks operation-order sections, folded completed steps, finished-task hiding, and fresh replacement for the next task.
The native worktree suite separately carries and resumes distinct checklist states through new, enter, leave, and cleanup.
Installer tests cover fresh ownership, recorded upgrades, personal settings, and refusal to adopt a matching unowned extension.
These checks do not prove real terminal keyboard/rendering behavior, real RPC client rendering, or availability of every conditional Claude task tool.
Live installation still requires separate approval.
