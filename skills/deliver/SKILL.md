---
name: deliver
description: Commit outstanding changes when needed, then deliver a managed Orchard task according to project policy through local integration or an A5 pull request. Use when the user asks to deliver, merge, land, or finish an active task.
argument-hint: "[intent] [--keep]"
---

# Deliver

Own the complete commit-if-needed and delivery workflow while reusing [the commit skill](../commit/SKILL.md) and [the Orchard skill](../orchard/SKILL.md).
Read [the Orchard workflow](../orchard/references/workflow.md) before continuing.

Run Orchard preflight and require the current checkout to be a managed task worktree before changing repository state.
If the executable is absent or protocol-incompatible, stop with Git dotfiles installation guidance.
If the current checkout is unmanaged, stop rather than guessing an integration target.

## Commit if needed

Inspect the checkout state.
If the checkout has changes, load and follow the commit skill to create one focused commit, forwarding the intent or scope from `$ARGUMENTS` but not the delivery-only `--keep` flag.
Treat the user's delivery request as an explicit commit request, but preserve every commit-skill hard stop and request user input when that skill requires it.
Do not reproduce staging, message, or commit policy inside this skill.
If the checkout is already clean, skip committing.
After the commit step, require a clean checkout before delivery; stop if changes remain or the commit skill did not complete successfully.

## Select the delivery route

If the current repository is an A5 project:

1. Resolve the pull-request target remote and inspect read-only remote metadata for the feature branch, checking both its configured upstream and a same-named remote head.
2. If the target remote or publication status is ambiguous, stop and ask the user rather than guessing.
3. If a published head exists, record its tip before rebasing and require that object to remain available for the post-rebase ancestry check.
4. Run Orchard's rebase flow, forwarding the optional intent but not the merge-only `--keep` flag.
5. After rebase, if a recorded published tip is not an ancestor of the rebased feature tip, stop and ask the user how to publish the rewritten branch; never force-push or invoke pull-request creation from that state.
6. Only after those checks succeed, run exactly `git pr create --web --fill` from the active feature checkout.
7. Treat opening the pull-request form as the terminal delivery action and do not invoke Orchard merge.

For every other project, forward `$ARGUMENTS` unchanged to the installed Orchard merge command through the harness transition in the workflow reference.
Orchard merge itself synchronizes trunk and rebases the task before fast-forwarding, so do not run a redundant preliminary rebase.
Use Orchard's returned transition and cleanup operation exactly.

The installed flows fast-forward a behind trunk, accept a local trunk ahead of upstream, refuse divergence, automatically abort rebase failures, never create merge commits, and never push.
Never fall back to raw Git integration.
