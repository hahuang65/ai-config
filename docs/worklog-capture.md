# Worklog capture without interrupting a run

Pi's owned `/worklog` command is separate from the model-driven [work-log skill](../skills/work-log/SKILL.md) and the current-task [session checklist](session-checklist.md).
It does not change Herdr configuration or emit another agent completion for a reminder.

## Commands

- `/worklog REQUEST` uses Jev to distinguish a new reminder from another Worklog request.
  A clear new reminder records the literal text as a planned reminder in the current Git project through the package-owned `wl note` executable.
  The UI acknowledges its returned ID, project, and title.
- Other requests, such as `/worklog let's do 600`, `/worklog complete 600`, or `/worklog history`, go to the shared work-log skill as a normal user message.
  While busy, Pi queues that message after current work instead of steering or aborting it.
  Uncertain, low-confidence, unavailable, malformed, or failed classifications take this same path without a direct write.
- Empty `/worklog` lists all incomplete tasks across projects, including unassigned work, with only ID, state, project, and title.
  An empty result displays `No incomplete Worklog tasks.`
- Empty invocation of the shared work-log skill requests the same incomplete-task listing through the model.
  The skill adds no per-task commentary or task-start action.
- Bare `wl` provides the same all-project incomplete-task overview in the shell.
  Its text output contains only task rows; an empty result emits no text.
  `wl --json` preserves the normal collection schema.
  Explicit `wl list` still defaults to the current project and a bounded page.

The classifier receives only the request text, not conversation history, project files, or the Worklog store.
It uses Pi's native `typesafe/jev-latest` classifier and existing authentication, without enabling codemode or changing TypeSafe configuration.
Nonempty input therefore makes a separate classifier service call and uses its tokens, even when no conversation-model turn follows.
That command-side usage is not attached to a tool result or added to the session cost display.
Bare software-work titles, such as `Add keyboard shortcuts`, mean new reminders by default.
Existing task references, immediate implementation requests, named-project or unassigned targets, and mixed operations need the skill's context.

Only a valid `reminder` Choice with confidence at least 0.8 and reminder probability at least 0.9 permits direct capture.
These are conservative initial policy thresholds, not a guarantee of intent accuracy.
The classifier has a five-second abort deadline; expiry delegates to the skill rather than creating a reminder.
The adapter itself never starts, completes, abandons, deduplicates, or updates existing tasks.
The skill interprets those requests under its normal authorization and clarification rules.
Nonempty input must be single-line and no more than 2048 UTF-8 bytes.
Do not include credentials or private customer data.

## Runtime and failure boundaries

The [adapter](../harnesses/pi/worklog.ts) installs through [its generated bundle](../harnesses/pi/worklog.bundle.ts) at `~/.pi/agent/extensions/worklog.ts`.
It resolves the executable from its real package source, never PATH or a reviewed project's tools.
It invokes the executable asynchronously with an argument array, a 15-second deadline, and an 8 MiB output limit.
Titles cannot execute shell syntax, and UI text strips terminal controls and bidirectional overrides.
Read-only listing failures remain errors, not empty results; a bounded CLI query is available for diagnosis.

Pi handles extension commands before its normal busy-run prompt queue.
Clear reminder capture does not send messages, append session entries, wait for idle, abort, steer, or queue follow-ups.
Delegated requests intentionally use the normal conversation pipeline and can produce another model turn and completion.
A shutdown listener cancels pending classifications on session replacement or reload, preventing a late result from writing or queueing into the old session.
The extension registers no model tool, polling worker, or completion notification.
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
Synthetic classifier responses cover existing-task routing while busy, idle operation dispatch, uncertain and invalid answers, unavailable authentication/service paths, deadline expiry, and reload cancellation.
Those deterministic tests verify routing, not Jev's semantic accuracy.
A separate live smoke evaluation of 16 synthetic requests passed the final capture policy, including the reported `let's do 600` case, bare reminders, existing-task references, mixed operations, and other-project/unassigned targets.
Observed classifier calls took 105–262 ms in that evaluation; these samples do not establish a latency guarantee or broad accuracy.
The tests contact no live provider or Herdr service and do not install into the live home.

`test/package-install-worklog.test.ts` checks ownership, recorded upgrades, preservation of personal settings/extensions, and refusal to adopt an unowned matching extension.
`tools/worklog/tests` checks no-subcommand behavior across projects through the process boundary.
Shared-skill checks verify instruction routing, not guaranteed model compliance.
These tests do not prove live terminal keyboard behavior, real RPC-client rendering, or Herdr notification behavior.
Live installation and any manual reload still require separate approval.
