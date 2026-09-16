# Findings and Decisions

A Finding has an impact classification and a separate ownership classification.
Its severity is `error`, `warning`, or `info`; its action is `auto-fix`, `ask-user`, or `no-op`, and a missing or uncertain action fails closed to `ask-user`.

## Required fields

Every Finding contains a stable round-independent ID, severity, action, an exact one-indexed `path:line` anchor in the reviewed change, a neutral source-verifiable invariant or acceptance statement, concise title, concrete description, supporting evidence, and repair direction.
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

Persist each Finding's ID, original anchor, source-verifiable invariant or acceptance statement, disposition, user instructions, repair round, and the reviewed head or worktree state.
The anchor and invariant form the prior Finding record that lets a targeted reviewer verify the same defect without receiving reviewer reasoning.
A prior Finding record can originate in a complete or targeted review; the final complete reviewer independently verifies the resulting change without inheriting that record.
A user-authored Finding selected for repair must supply an exact changed anchor and a source-verifiable acceptance statement; those neutral fields form its prior Finding record without inventing reviewer output.
The decision ledger is the only decision memory shared with a fresh targeted Change reviewer.
A final complete manifest receives no decision ledger or prior Finding records.
After its independent result returns, the orchestrator reconciles prior user dispositions against current Findings and preserves a disposition unless materially changed code created a distinct defect.
Reconcile the stable Finding ID by matching the source-verifiable invariant, anchor lineage, and current source state; assign a new ID only for a distinct defect.
A targeted Review manifest may also carry prior Finding records and the prior Inspection ledger as content-identified routing data, but it never carries reviewer reasoning, evidence summaries, session history, or Change fixer rationale.
A user-dispositioned Finding stays closed unless materially changed code creates a new problem.

## Build approval

In build mode, every `ask-user` Finding needs an explicit disposition before the change can be approved.
Available build decisions are fix selected, approve as-is with explicit dispositions, add a user-authored Finding, or attach instructions to an existing Finding.
Standalone modes preserve `ask-user` Findings in the results report and finish without requesting approval.
