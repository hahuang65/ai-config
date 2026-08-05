#!/usr/bin/env node

import { parsePrivateServerInvocation } from "../runtime/arguments.mjs";
import { runReviewCommand } from "../runtime/cli.mjs";
import { reviewPort, stateFile } from "../runtime/paths.mjs";
import { startReviewServer } from "../runtime/server.mjs";
import { credentialRedactedPreview } from "../../shared/runtime/safe-preview.mjs";

const args = process.argv.slice(2);

try {
  if (parsePrivateServerInvocation(args)) {
    await startReviewServer({
      port: reviewPort(),
      stateFile: stateFile(),
      agentToken: process.env.REVIEW_ARTIFACT_AGENT_TOKEN,
    });
  } else {
    const output = await runReviewCommand(args);
    if (output.type === "help") {
      process.stdout.write(output.text);
    } else {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
  }
} catch (error) {
  const message = credentialRedactedPreview(error.message, 300).text;
  process.stderr.write(`review-artifact: ${message}\n`);
  if (error.code === "USAGE_ERROR") {
    const helpCommand = error.command ? `review-artifact ${error.command} --help` : "review-artifact --help";
    process.stderr.write(`Run ${helpCommand} for usage.\n`);
  }
  process.exitCode = error.code === "USAGE_ERROR" ? 2 : 1;
}
