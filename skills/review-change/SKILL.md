---
name: review-change
description: Review an explicit local change, Git range, or GitHub pull request through a restricted runner and an HTML report. Publication requires separate human terminal confirmation.
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
   Follow the shared `html-routing` rule when opening the report in the ordinary browser.
   Distinguish defects from changed-code refactoring and existing-code reuse.
   Ask the user to select repairs; in coach mode, preserve user ownership of source and tests.
   Verify selected repairs and request a fresh review of the changed state.
   Unavailable review is incomplete, never a clean result.
4. If the user wants to publish pull-request findings, give them `review-change-eval post REPORT` for their own terminal.
   Never call posting through an agent shell, create a pseudo-terminal, supply confirmation, or treat a browser action as approval.
   The human selects findings, previews the exact request, and confirms afresh; the CLI sends `COMMENT` only.
   If posting is uncertain, reconcile that same retained report rather than creating another submission.
   A changed revision requires a fresh review.

The reviewer does not edit, install, commit, push, or publish changes.
Keep authentication private and record only meaningful progress through [work-log](../work-log/SKILL.md).
See the [CLI contract and limits](../../docs/review-change-cli.md) for scope and retained-state recovery.
