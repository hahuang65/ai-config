#!/usr/bin/env node

import { parseArguments } from "../runtime/arguments.mjs";
import { runReviewChange } from "../runtime/runner.mjs";
import { renderBoundaryFailureSummary } from "../runtime/summary.mjs";
import { assertSupportedNode } from "../runtime/version.mjs";
import { credentialRedactedPreview } from "../../shared/runtime/safe-preview.mjs";

const help = `Usage: review-change [target] [options]

Run the Review change validation gate through pi without entering an agent session.

Arguments:
  target                 One local or GitHub review target

Local targets:
  feature/name           Local branch
  origin/<branch>        Same freshness rule as its paired local branch
  main...HEAD            Local Git range; base..head is also accepted

Pull-request shorthand:
  pull/<number> or bare number; for example, pull/59 or 59
                         Use a canonical positive number through 2147483647
                         Exact local branch names win before shorthand
                         Select the GitHub origin, or the only GitHub remote
                         Stop when no unique GitHub remote exists

GitHub pull-request targets:
  https://github.com/owner/repository/pull/59/changes?diff=split#discussion
                         A suffix, query, or fragment is ignored
                         URLs require the canonical GitHub HTTPS origin
  gh:owner/repository/pull/59
                         gh: identifiers reject URL suffixes, queries, and fragments

GitHub branch targets:
  https://github.com/owner/repository/tree/feature/branch/src/file
                         A slash-bearing branch uses the longest existing branch prefix
  gh:owner/repository/tree/feature/branch

Scope rules:
  A mutable local branch captures its configured matching remote before isolation and
  requires an isolated fetch. Its raw URL loses only one Git output terminator; any
  remaining C0, C1, or DEL control stops before URL normalization or fetch.
  It configures the credential-safe URL in the workspace and fetches it only there.
  The descendant of the local and matching-remote tips wins.
  The fetched repository default branch from that remote supplies the base.
  Before child evidence, the parent materializes that exact selected local head and
  replays the captured tracked patch and untracked files in the disposable workspace.
  Replay conflict stops with cleanup; an explicit range does not rematerialize.
  Explicit origin/<branch> uses origin.
  Diverged tips or fetch failure stop resolution.
  Shorthand accepts only a documented GitHub SSH or HTTPS remote on its default port
  and rejects normalization-sensitive raw path segments before normalization.
  An explicit GitHub target directly acquires its named repository without checkout.
  A direct branch resolves provider id and canonical nameWithOwner before clone, then queries
  canonical metadata plus selected and default OIDs by that immutable ID after acquisition.
  Both clone OIDs must match before A5 classification; Git proves content equivalence, not
  repository-ID binding. An A→B→A name race is safe only when both OID pairs match.
  The requested identity only selects acquisition. Unrelated clone refs are ignored, and
  Trusted materialization receives only the exact selected OID. Any mismatch cleans recorded paths.
  A remote change is Untrusted by default, remains unmaterialized, and is never executed.
  A5 uses the canonical SSH identity from provider metadata plus effective global or system
  Git configuration in a base-independent temporary context; repository-local configuration cannot grant trust.
  --sandbox applies only when this process already runs inside the documented sandbox.
  The parent requires REVIEW_CHANGE_SANDBOX plus its fixed root-owned marker.

Options:
  --intent <text>        Authoritative intent for the change
  --trust-remote         Explicitly trust one direct GitHub target for materialization
  --sandbox              Use the verified documented sandbox already containing this process
  --provider <name>      pi provider override (requires --model)
  --model <name>         pi model inherited by mandatory review subagents
  --thinking <level>     pi outer-process thinking-level override
  --help                 Show this help

With no target, Review change resolves the current branch pull request or branch point.
Every CLI review is read-only and runs in a disposable isolated clone.
Every explicit GitHub pull-request or branch target acquires its named repository regardless of current directory.
In a TTY, the terminal shows a full-screen pipeline with the active sub-stage intent and retained per-stage STEP/activity logs.
Bounded entries and stages disclose omitted counts; FULL LOG points to complete credential-redacted telemetry inside the isolated clone.
Use j/k to navigate stages, Ctrl-D/Ctrl-U to scroll the log, Enter to expand or collapse lines, f to follow the active stage, ? for help, and Ctrl-C to abort an active run.
The TTY renders Markdown with Glow when available and keeps the pipeline/log layout on the final Summary stage; use Ctrl-U and Ctrl-D to scroll, then Ctrl-C to exit the completed review.
While that Summary remains open, copied Finding paths point into the retained isolated review clone.
The clone is removed after dismissal; non-interactive output uses plain status lines and prints the textual summary normally.
The completed HTML report opens automatically in the browser; no review-artifact approval is required.
Pull-request reports include copyable Markdown.
The command never stages, commits, pushes, or mutates provider state.
`;

try {
  assertSupportedNode(process.versions.node);
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    parseArguments(args);
    process.stdout.write(help);
  } else {
    const options = parseArguments(args);
    process.exitCode = await runReviewChange(options);
  }
} catch (error) {
  const message = credentialRedactedPreview(error.message, 300).text;
  process.stderr.write(`review-change: ${message}\n`);
  if (error.code === "USAGE_ERROR") process.stderr.write("Run review-change --help for usage.\n");
  process.exitCode = error.code === "USAGE_ERROR" ? 2 : 1;
  if (!error.reviewChangeSummaryPrinted) {
    process.stdout.write(renderBoundaryFailureSummary(error, process.exitCode));
  }
}
