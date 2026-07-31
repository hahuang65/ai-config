#!/usr/bin/env node

import { parseArguments } from "../runtime/arguments.mjs";
import { runReviewChange } from "../runtime/runner.mjs";
import { renderBoundaryFailureSummary } from "../runtime/summary.mjs";
import { assertSupportedNode } from "../runtime/version.mjs";

const help = `Usage: review-change [target] [options]

Run the Review change validation gate through pi without entering an agent session.

Arguments:
  target                 Branch name, Git range, GitHub pull-request URL, or pull-request number

Options:
  --intent <text>        Authoritative intent for the change
  --provider <name>      pi provider override (requires --model)
  --model <name>         pi model inherited by mandatory review subagents
  --thinking <level>     pi outer-process thinking-level override
  --help                 Show this help

With no target, Review change resolves the current branch pull request or branch point.
Every CLI review is read-only and runs in a disposable isolated clone of the current working state.
In a TTY, the terminal shows a full-screen pipeline with the active sub-stage intent and retained per-stage STEP/activity logs.
Use j/k to navigate stages, Ctrl-D/Ctrl-U to scroll the log, Enter to expand or collapse lines, f to follow the active stage, ? for help, and Ctrl-C to abort an active run.
After cleanup, the TTY renders Markdown with Glow when available and keeps the pipeline/log layout on the final Summary stage; use Ctrl-U and Ctrl-D to scroll, then Ctrl-C to exit the completed review.
Non-interactive output uses plain status lines and prints the textual summary normally.
The completed HTML report opens automatically in the browser; no review-artifact approval is required.
Pull-request reports include copyable Markdown.
The command never stages, commits, pushes, or mutates provider state.
`;

try {
  assertSupportedNode(process.versions.node);
  if (process.argv.includes("--help")) {
    process.stdout.write(help);
  } else {
    const options = parseArguments(process.argv.slice(2));
    process.exitCode = await runReviewChange(options);
  }
} catch (error) {
  process.stderr.write(`review-change: ${error.message}\n`);
  if (error.code === "USAGE_ERROR") process.stderr.write("Run review-change --help for usage.\n");
  process.exitCode = error.code === "USAGE_ERROR" ? 2 : 1;
  if (!error.reviewChangeSummaryPrinted) {
    process.stdout.write(renderBoundaryFailureSummary(error, process.exitCode));
  }
}
