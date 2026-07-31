# Findings and Decisions

A Finding has an impact classification and a separate ownership classification.
Its severity is `error`, `warning`, or `info`; its action is `auto-fix`, `ask-user`, or `no-op`, and a missing or uncertain action fails closed to `ask-user`.

## Required fields

Every Finding contains a stable round-independent ID, severity, action, an exact one-indexed `path:line` anchor in the reviewed change, concise title, concrete description, supporting evidence, and repair direction.
Choose the closest actionable changed line when the concern spans a block or multiple files, and include additional `path:line` anchors when they materially help.
If no reviewed file and line can anchor the concern, do not emit it as a Finding; record it as unproven coverage or general report context instead.
Use terminology already present in Authoritative intent, source, tests, or project documentation.
When a new term is unavoidable, define it in plain language at first use.
Keep IDs stable when the same defect survives a rereview.
Assign a new ID when materially changed code creates a distinct defect.

## Severity

- `error` — blocks build completion without repair or an explicit human override; standalone modes report it without mutation.
- `warning` — material but reasonable to accept for follow-up.
- `info` — useful context requiring no repair.

## Action

- `auto-fix` — objective and low-risk without product or intent judgment.
- `ask-user` — intent-sensitive, ambiguous, behavior-changing, or unsupported by sufficient evidence.
- `no-op` — informational only.

Severity does not imply action.
An error can require user judgment, and an informational Finding can describe an automatically completed repair.

## Decision ledger

Persist each Finding's ID, disposition, user instructions, repair round, and the reviewed head or worktree state.
The ledger is the only memory shared with a fresh Change reviewer.
Never include Change fixer rationale.
A user-dispositioned Finding stays closed unless materially changed code creates a new problem.

## Build approval

In build mode, every `ask-user` Finding needs an explicit disposition before the change can be approved.
Available build decisions are fix selected, approve as-is with explicit dispositions, add a user-authored Finding, or attach instructions to an existing Finding.
Standalone modes preserve `ask-user` Findings in the results report and finish without requesting approval.
