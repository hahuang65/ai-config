---
name: review-change
description: Validate a local change or pull request against its authoritative intent through adversarial review, targeted evidence, documentation checks, and lint. Use as the final /build phase or standalone for a branch, Git range, or GitHub pull request.
argument-hint: [branch | base...head | pull-request-url-or-number | intent]
compatibility: Standalone CLI requires Node.js 22+ and pi.
---

# Review Change

Validate one specific change against its **Authoritative intent** and return substantiated **Findings** rather than general advice.
This is the mandatory final `/build` phase and also runs standalone for branches, local ranges, and pull requests.
Architectural deepening remains the separate optional `/review-code` workflow.

## Modes

- **Build** — validate the feature change and drive the Review-to-done gate.
- **Local range** — review an explicit Git base/head range without mutating it.
- **Pull request** — review a GitHub pull request locally and read-only.
- **Standalone CLI** — drive the same read-only workflow through a foreground pi process in a disposable isolated clone.

## Workflow

Follow [references/workflow.md](references/workflow.md) for scope resolution, the fixed validation kernel, and completion behavior.
Use [references/findings.md](references/findings.md) for the Finding schema, fail-closed actions, and decision ledger.
Use [references/evidence.md](references/evidence.md) for focused Validation evidence and missing-evidence behavior.
Use [references/repair-loop.md](references/repair-loop.md) for role isolation, bounded repairs, restart selection, and rereview.
Use [references/pull-requests.md](references/pull-requests.md) for GitHub scope resolution, disposable worktrees, trust classification, and provider boundaries.
Use [references/report.md](references/report.md) for portable HTML, build-mode `review-artifact` interaction and decision controls, and standalone one-shot opening without approval.
When `REVIEW_CHANGE_GATE=1`, follow [references/cli-mode.md](references/cli-mode.md) for process ownership, argument safety, repair eligibility, and terminal behavior.
When invoked by `/build`, follow [references/build-mode.md](references/build-mode.md) for feature scope, specialist review, artifact synchronization, and the Review-to-done gate.

## Standalone presentation

For a standalone local-range or pull-request invocation inside an agent session, write the completed results-only HTML report, open it once in the platform's ordinary web browser, and return the review results without starting `review-artifact` or waiting for approval.
Treat the report path as data and pass it to the viewer without shell interpolation.
When `REVIEW_CHANGE_GATE=1`, do not open the file from the child process because the parent CLI validates and opens it.

## Standalone CLI

`review-change` runs this same workflow outside an existing agent session through an isolated foreground `pi` process.
The repository installer links the executable into `~/.local/bin/review-change`.
It accepts one branch name, local range, or GitHub pull-request target plus optional `--intent`, `--provider`, `--model`, and `--thinking` overrides.

## Boundaries

Never stage, commit, push, post comments, submit a provider review, approve a pull request, request provider-side changes, merge, or monitor delivery CI to completion.
