---
name: change-review
description: Validate a local change or pull request against its authoritative intent through adversarial review, targeted evidence, documentation checks, and lint. Use as the final /build phase or standalone for a branch, Git range, or GitHub pull request.
argument-hint: [branch | base...head | pull-request-url-or-number | intent]
compatibility: Standalone CLI requires Node.js 22+ and pi.
---

# Change Review

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
When `CHANGE_REVIEW_GATE=1`, follow [references/cli-mode.md](references/cli-mode.md) for process ownership, argument safety, repair eligibility, and terminal behavior.
When invoked by `/build`, follow [references/build-mode.md](references/build-mode.md) for feature scope, specialist review, artifact synchronization, and the Review-to-done gate.

## Standalone presentation

For a standalone local-range or pull-request invocation inside an agent session, write the completed results-only HTML report, open it once in the platform's ordinary web browser, and return the review results without starting `review-artifact` or waiting for approval.
Treat the report path as data and pass it to the viewer without shell interpolation.
When `CHANGE_REVIEW_GATE=1`, do not open the file from the child process because the parent CLI validates and opens it.

## Standalone CLI

`change-review` runs this same workflow outside an existing agent session by launching an isolated foreground `pi` process.
The repository installer links the executable into `~/.local/bin/change-review`.
It accepts one branch name, local range, or GitHub pull-request target plus optional `--intent`, `--provider`, `--model`, and `--thinking` overrides.
Every CLI invocation is read-only and snapshots tracked plus untracked working state into a disposable isolated clone under `~/.review-treehouse/` before launching pi, keeping review isolation separate from development worktrees under `~/.treehouse/`.
A selected CLI model is inherited by mandatory Change review subagents, while the CLI-specific pi guard blocks structured repository writes, direct shell mutation, staging, commits, pushes, and provider mutations.
The only writable tool path is a dedicated report directory validated not to overlap either checkout.
The CLI shows a color-coded full-screen TTY with `NO_COLOR` support: wide terminals place the pipeline on the left and the selected log on the right, while narrow terminals use a stacked fallback.
Use `j`/`k` to navigate stages, Ctrl-D/Ctrl-U to scroll the selected log, Enter to expand or collapse lines, and `f` to resume following the active stage.
Ctrl-C is the only active-run abort key; no single-character key aborts or closes the review.
Every pipeline stage lists its purpose and recorded sub-stages vertically beneath its status with a live or completed elapsed timer beside every sub-stage.
Keep sub-stage and collected-item messages to six words or fewer; emit one `log` event per Finding, missing-evidence item, documentation issue, or similar result so the left pane lists each beneath its parent sub-stage without repeating successful completion text.
The left pane enforces the sub-stage display bound while the selected right-pane log retains the bounded original telemetry message as a `STEP` entry.
The header shows the isolated review worktree path alongside immutable scope, risk, and open Findings.
Each active stage shows its current sub-stage as operational intent alongside bounded, credential-redacted lifecycle operations, tool calls, durations, and outcomes without exposing hidden model reasoning; non-interactive output falls back to plain status lines.
Adversarial review separately announces scope and intent setup, fresh reviewer dispatch, coverage checking, and Finding/risk normalization.
The parent validates ordered successful telemetry, requires an observable sub-stage before successful stage completion, and owns interruption through cleanup.
In a TTY it renders parent and assistant Markdown through bounded non-interactive Glow when available, forces Glow color when terminal color is enabled, rerenders after terminal-width changes, and falls back to the built-in renderer on missing, failed, oversized, or timed-out Glow output.
It keeps that summary plus the report path in the scrollable final stage within the existing pipeline/log layout until Ctrl-C exits the completed review, then restores the terminal without duplicate shell output; Ctrl-D remains dedicated to downward scrolling, and non-interactive runs print the summaries normally.
It opens the completed disposable HTML report in a new Firefox window on macOS, or the platform HTML viewer elsewhere, without waiting for browser closure, starting `review-artifact`, or waiting for approval, and includes one copyable general comment and separately copyable inline Finding comments inside pull-request reports, with exact locations, a severity/action legend, and persistent copied-state styling.
When `CHANGE_REVIEW_GATE=1`, an outer CLI gate already owns orchestration: execute only the assigned workflow and never invoke the `change-review` executable recursively.

## Boundaries

Never stage, commit, push, post comments, submit a provider review, approve a pull request, request provider-side changes, merge, or monitor delivery CI to completion.
