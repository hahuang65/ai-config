# Worklog capture without interrupting a run

Pi's owned `/worklog` command is separate from the model-driven [work-log skill](../skills/work-log/SKILL.md) and the current-task [session checklist](session-checklist.md).
It does not change Herdr configuration or emit another agent completion for a reminder.

## Commands

- `/worklog REMINDER` records the literal title as a planned reminder in the current Git project.
  It uses the package-owned `wl note` executable and acknowledges the returned ID, project, and title in the UI.
- Empty `/worklog` lists all incomplete tasks across projects, including unassigned work, with only ID, state, project, and title.
  An empty result displays `No incomplete Worklog tasks.`
- Empty invocation of the shared work-log skill requests the same incomplete-task listing through the model.
  The skill adds no per-task commentary or task-start action.
- Bare `wl` provides the same all-project incomplete-task overview in the shell.
  Its text output contains only task rows; an empty result emits no text.
  `wl --json` preserves the normal collection schema.
  Explicit `wl list` still defaults to the current project and a bounded page.

All nonempty `/worklog` arguments are reminder text, not flags or model instructions.
The command does not infer a different project from that text, deduplicate reminders, start work, or record progress.
Use the CLI or shared skill when a named project, unassigned reminder, or another Worklog operation is needed.
A reminder title must be nonblank, single-line, and no more than 2048 UTF-8 bytes.
Do not include credentials or private customer data.

## Runtime and failure boundaries

The [adapter](../harnesses/pi/worklog.ts) installs through [its generated bundle](../harnesses/pi/worklog.bundle.ts) at `~/.pi/agent/extensions/worklog.ts`.
It resolves the executable from its real package source, never PATH or a reviewed project's tools.
It invokes the executable asynchronously with an argument array, a 15-second deadline, and an 8 MiB output limit.
Titles cannot execute shell syntax, and UI text strips terminal controls and bidirectional overrides.
Read-only listing failures remain errors, not empty results; a bounded CLI query is available for diagnosis.

Pi handles extension commands before its normal busy-run prompt queue.
This command does not send messages, append session entries, wait for idle, abort, steer, or queue follow-ups.
It registers no model tool, lifecycle listener, polling worker, or completion notification.
Interactive and RPC sessions receive UI acknowledgements; headless invocations are rejected before writes and should use the CLI instead.
RPC clients may ignore their notifications.

A write failure or malformed receipt cannot prove that no reminder was recorded.
The adapter reports uncertainty and asks the user to inspect Worklog history before retrying.
It never retries automatically, including when a successful write's UI acknowledgement fails.
Repeated explicit captures create separate reminders.
The command does not associate its reminder with the session checklist or replace the current task.

## Verification and limits

`test/package-pi-worklog.test.ts` loads a manifest-linked copy of the bundle through the installed Node/Pi SDK with a disposable home and Worklog store.
A held synthetic provider response proves capture while the native session is busy, with one request, one agent start, one completion, and one settled event.
It also checks unchanged conversation entries, empty queues, no abort, literal shell text, RPC behavior, UI failure, missing executable, invalid titles, empty listings, and headless rejection.
The tests contact no live provider or Herdr service and do not install into the live home.

`test/package-install-worklog.test.ts` checks ownership, recorded upgrades, preservation of personal settings/extensions, and refusal to adopt an unowned matching extension.
`tools/worklog/tests` checks no-subcommand behavior across projects through the process boundary.
Shared-skill checks verify instruction routing, not guaranteed model compliance.
These tests do not prove live terminal keyboard behavior, real RPC-client rendering, or Herdr notification behavior.
Live installation and any manual reload still require separate approval.
