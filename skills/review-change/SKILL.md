---
name: review-change
description: Review an explicit local change, Git range, or GitHub pull request through a restricted runner, then collect annotations and per-finding repair decisions. Publication requires separate human terminal confirmation.
---

# Review a change

Use the replacement's standalone Rust reviewer, never the old review runtime.
Ordinary session skill discovery remains enabled; the reviewer itself is isolated.

1. Establish the explicit target and its authoritative intent.
   Choose `local`, `range BASE..HEAD`, or `pr https://github.com/OWNER/REPO/pull/NUMBER`.
   Review the whole task from its recorded starting revision, not only the latest edit.
   Local mode covers HEAD to working state; range mode covers committed endpoints.
   Do not absorb unrelated work or claim a review proves tests ran.
2. Resolve `../../tools/evaluation/target/release/review-change-eval` from the absolute path of this skill file.
   If it is absent, stop; do not install tools or use another reviewer.
   Read the review command's `--help` to identify supported `--engine` values.
   Select the engine matching the current host, not the skill's source path, the CLI default, or untrusted project content.
   If the host or matching engine cannot be identified, stop and ask rather than guessing.
   Each engine has its own restricted runner and authentication; do not fall back to another engine when one is unavailable.
   Run `review TARGET --engine ENGINE --repo ABSOLUTE_REPOSITORY --intent TEXT --json` with literal arguments.
   Use `--path RELATIVE_PATH` only for an explicit narrower scope.
   The runners freeze bounded source evidence and restrict the reviewer's tools to snapshot reads.
   Do not execute reviewed code or fill evidence gaps without authorization.
3. Read the bounded JSON result and present the HTML report path, scope, findings, and limits.
   Distinguish defects from changed-code refactoring and existing-code reuse.
   For repair decisions, use [review-artifact](../review-artifact/SKILL.md) with `open REPORT.html --findings REPORT.json`, using the exact returned paths.
   The shell places Accept/Reject inside each rendered finding, with annotations and general feedback in the sidebar.
   Accept authorizes repairing that finding; Reject and undecided findings authorize no repairs.
   Only process saved accept events whose revision matches `current_revision` and `finding_review.revision`, with `finding_review.needs_review` false.
   Verify the retained JSON's SHA-256 equals `finding_review.report_digest` before mapping its IDs to repairs.
   Reject mismatched, missing, or changed evidence; request a fresh review rather than transferring IDs or decisions between reports.
   The report must still describe the relevant code; unrelated source changes require a fresh review, while earlier authorized repairs in the same batch remain explicit context.
   Process comments within the accepted finding's scope; ask about conflicting instructions, and preserve user ownership of source and tests in coach mode.
   Never submit accept/reject events yourself, infer acceptance from feedback or a closed browser, or repair a finding twice after event replay.
   Record handled cursors and repair outcomes; continue indefinite foreground `wait` calls until all findings are decided or the user ends the review.
   Saved decisions are final for that report; requests to change them need explicit chat clarification, not fabricated replacement events.
   Verify accepted repairs and request a fresh review of the whole changed task, at a new retained report path.
   Never rewrite the retained report, its JSON, or signatures to record decisions or fixes.
   Rejection is not a verified fix, and an all-decided report is not blanket code approval.
   Browser decisions never authorize staging, commits, installation, delivery, or publication.
   For an explicitly informational request, present the report normally without soliciting decisions.
   If the browser workflow is unavailable, report the limitation and ask to collect explicit finding-ID decisions in chat; never silently substitute whole-report approval.
   Unavailable restricted review is incomplete, never a clean result.
4. If the user wants to publish pull-request findings, give them `review-change-eval post REPORT` for their own terminal.
   Never call posting through an agent shell, create a pseudo-terminal, supply confirmation, or treat a browser action as approval.
   The human selects findings, previews the exact request, and confirms afresh; the CLI sends `COMMENT` only.
   If posting is uncertain, reconcile that same retained report rather than creating another submission.
   A changed revision requires a fresh review.

The reviewer does not edit, install, commit, push, or publish changes.
Keep authentication private and record only meaningful progress through [work-log](../work-log/SKILL.md).
See the [CLI contract and limits](../../docs/review-change-cli.md) for scope and retained-state recovery.
