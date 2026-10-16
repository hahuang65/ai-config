---
name: review-change
description: Review an explicit local change, Git range, or GitHub pull request through a restricted runner, then collect annotations and per-finding repair decisions. Publication requires separate human confirmation of the exact preview in the report.
---

# Review a change

Use the replacement's standalone Rust reviewer, never the old review runtime.
Ordinary session skill discovery remains enabled; the reviewer itself is isolated.

1. Establish the explicit target and its authoritative intent.
   Choose `local`, `range BASE..HEAD`, or `pr https://github.com/OWNER/REPO/pull/NUMBER`.
   Review the whole task from its recorded starting revision, not only the latest edit.
   Local mode covers HEAD to working state; range mode covers committed endpoints.
   Do not absorb unrelated work or claim a review proves tests ran.
2. Resolve `../../tools/evaluation/target/release/review-change` from the absolute path of this skill file.
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
   For repair decisions, read and follow [review-artifact](../review-artifact/SKILL.md), including its finding-review mode, with `open REPORT.html --findings REPORT.json` and the exact returned paths.
   That skill owns foreground waiting, cursor and reply retries, revision/digest validation, and saved-decision finality.
   Apply its evidence checks before mapping accepted finding IDs to repairs; request a fresh review for mismatched, missing, or changed evidence.
   Accept authorizes repairing that finding; Reject and undecided findings authorize no repairs.
   The report must still describe the relevant code; unrelated source changes require a fresh review, while earlier authorized repairs in the same batch remain explicit context.
   Process comments within the accepted finding's scope; ask about conflicting instructions, and preserve user ownership of source and tests in coach mode.
   Never submit accept/reject events yourself, infer acceptance from feedback or a closed browser, or repair a finding twice after event replay.
   Record handled cursors and repair outcomes while following that skill's wait lifecycle.
   Verify accepted repairs and request a fresh review of the whole changed task, at a new retained report path.
   Never rewrite the retained report, its JSON, or signatures to record decisions or fixes.
   Rejection is not a verified fix, and an all-decided report is not blanket code approval.
   Browser decisions never authorize staging, commits, installation, delivery, or publication.
   For an explicitly informational request, present the report normally without soliciting decisions.
   If the browser workflow is unavailable, report the limitation and ask to collect explicit finding-ID decisions in chat; never silently substitute whole-report approval.
   Unavailable restricted review is incomplete, never a clean result.
4. If the user wants to publish pull-request findings, direct them to the report's separate publication controls in `review-artifact`.
   Only the human selects publication findings, previews the exact account/PR/revisions/request, and clicks Publish comments as final confirmation.
   Never submit publication selections, previews, confirmations, or terminal posting through model tools; do not synthesize clicks or confirmation requests.
   Repair Accept/Reject, ordinary artifact approval, silence, and review completion never authorize publication.
   Publication sends `COMMENT` only, not pull-request approval or requested changes.
   If the outcome is uncertain, the human uses Check publication status on that same report to reconcile the persisted attempt, never a new submission.
   A changed report or PR revision requires a fresh review.

The reviewer does not edit, install, commit, push, or publish changes.
Keep authentication private and record only meaningful progress through [work-log](../work-log/SKILL.md).
See the [CLI contract and limits](../../docs/review-change-cli.md) for scope and retained-state recovery.
