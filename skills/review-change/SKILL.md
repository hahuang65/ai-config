---
name: review-change
description: Validate a local change or GitHub change against its authoritative intent through adversarial review, targeted evidence, documentation checks, and lint. Use as the final /build phase or standalone for a local branch, Git range, GitHub pull request, or GitHub branch.
argument-hint: [local-branch | base...head | GitHub-pull-request-or-branch | intent]
compatibility: Standalone CLI requires Node.js 22+ and pi.
---

# Review Change

Validate one specific change against its **Authoritative intent** and return substantiated **Findings** rather than general advice.
This is the mandatory final `/build` phase and also runs standalone for local branches, Git ranges, GitHub pull requests, and GitHub branches.
Architectural deepening remains the separate optional `/review-code` workflow.

## Modes

- **Build** — validate the feature change and drive the Review-to-done gate.
- **Local range** — review an explicit Git base/head range without mutating it.
- **Pull request** — review a GitHub pull request locally and read-only.
- **Remote branch** — review a GitHub branch against its repository default branch read-only.
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

For a standalone local-range, pull-request, or remote-branch invocation inside an agent session, write the completed results-only HTML report, open it once in the platform's ordinary web browser, and return the review results without starting `review-artifact` or waiting for approval.
Treat the report path as data and pass it to the viewer without shell interpolation.
When `REVIEW_CHANGE_GATE=1`, do not open the file from the child process because the parent CLI validates and opens it.

## Standalone CLI

`review-change` runs this same workflow outside an existing agent session through an isolated foreground `pi` process.
The repository installer links the executable into `~/.local/bin/review-change`.
It accepts one local branch, `origin/<branch>`, or Git range, plus optional `--intent`, `--provider`, `--model`, and `--thinking` overrides.
It also accepts `pull/<number>` or a bare number, a GitHub pull-request URL with an optional suffix, query, or fragment, such as `https://github.com/owner/repository/pull/59/changes?diff=split#discussion`, or the exact identifier `gh:owner/repository/pull/59`.
GitHub branch forms are a tree URL with a slash-bearing branch or the exact identifier `gh:owner/repository/tree/feature/branch`; the longest existing branch prefix wins before a repository path suffix on a URL.
`gh:` identifiers reject URL suffixes, queries, and fragments.
Browser targets require the canonical GitHub HTTPS origin.
An exact local branch wins before shorthand, which selects the GitHub origin or the only GitHub remote when `origin` is not GitHub, and stops if no unique GitHub remote exists.
Remote discovery accepts only a documented GitHub SSH or HTTPS remote on its default port.
A mutable local branch captures its configured matching remote before isolation and requires an isolated fetch.
It reads that remote URL as one raw Git record, removes only one output terminator, and rejects every remaining C0, C1, or DEL control before URL normalization or fetch.
It configures the credential-safe URL in the workspace and fetches it only there.
It selects the descendant of the local and matching-remote tips and uses the fetched repository default branch from that remote as its base.
Before child evidence, the parent materializes that exact selected local head in the disposable workspace and replays the captured tracked patch and untracked files.
Untracked replay rejects symbolic-link destination ancestors, verifies existing parents remain beneath the workspace, and preserves only captured relative symbolic links whose target stays inside isolation.
Replay conflict, unsafe path replacement, or symbolic-link escape stops with cleanup instead of running stale evidence; an immutable explicit range does not rematerialize.
Explicit `origin/<branch>` uses `origin`; diverged tips or fetch failure stop.
Every explicit GitHub target directly acquires its named repository without checkout regardless of the current directory.
For a branch target, strictly resolve provider `id` and canonical `nameWithOwner` before clone, then query current canonical metadata plus selected and default branch OIDs by that immutable ID after acquisition.
Require both provider OIDs to equal the clone's corresponding OIDs before direct-branch A5 classification.
Git transport cannot attest clone repository node identity; this is content equivalence, not cryptographic repository-ID binding.
An A→B→A name-reuse race is safe when both OID pairs match, while any mismatch or provider failure stops with recorded cleanup.
The requested identity only selects acquisition; post-acquisition canonical provider metadata supplies `headRepository`.
Scope uses only the verified OIDs, unrelated clone refs are ignored, and Trusted materialization receives only the exact selected OID.
A directly acquired remote change is Untrusted by default and remains unmaterialized and unexecuted.
`--trust-remote` explicitly trusts one direct GitHub target; A5 trust requires effective global or system Git configuration to classify the actual head repository through canonical SSH identity, and repository-local configuration cannot grant trust.
A5 classification uses a recorded base-independent temporary Git context outside the acquired repository, exposes only the actual-head canonical SSH URL, and cleans exactly that context.
`--sandbox` applies only when this process already runs inside the documented sandbox.
The parent verifies `REVIEW_CHANGE_SANDBOX` and its fixed root-owned marker before exact-OID materialization, so the sandbox flag alone cannot grant trust.

## Boundaries

Never stage, commit, push, post comments, submit a provider review, approve a pull request, request provider-side changes, merge, or monitor delivery CI to completion.
