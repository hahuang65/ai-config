#!/usr/bin/env node

import { runReviewCommand } from "../runtime/cli.mjs";
import { reviewPort, stateFile } from "../runtime/paths.mjs";
import { startReviewServer } from "../runtime/server.mjs";

const args = process.argv.slice(2);

try {
  if (args[0] === "server") {
    await startReviewServer({
      port: reviewPort(),
      stateFile: stateFile(),
      agentToken: process.env.REVIEW_ARTIFACT_AGENT_TOKEN,
    });
  } else {
    const output = await runReviewCommand(args);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`review-artifact: ${error.message}\n`);
  process.exitCode = 1;
}
