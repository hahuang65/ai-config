#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import {
  handleInetdRequest,
  relayInetdRequest,
} from "../../skills/review-change/runtime/review-publication-inetd.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { loadPublicationKey } from "../../skills/review-change/runtime/review-publication-state.mjs";

const CONFIRMATION_PATH = "/api/v1/review-publication-confirmations";
const [mode, configurationFile] = process.argv.slice(2);
if (mode !== "--fixture-config" || !path.isAbsolute(configurationFile ?? "")) {
  throw new Error("The launchd fixture requires an absolute fixture configuration path");
}

const configuration = validateConfiguration(JSON.parse(await readFile(configurationFile, "utf8")));
await recordLifecycle("start");
try {
  const key = await loadPublicationKey({ home: configuration.home });
  await handleInetdRequest({
    input: process.stdin,
    output: process.stdout,
    requestTimeoutMs: 5_000,
    dispatch: (request, context) => dispatchConfirmation(request, context, key),
  });
} finally {
  await recordLifecycle("finish");
}

async function dispatchConfirmation(request, context, key) {
  if (request.path !== CONFIRMATION_PATH) {
    return { status: 404, headers: { "content-type": "text/plain" }, body: "Fixture permits confirmation only." };
  }
  const server = await createReviewPublicationServer({
    key,
    expectedHost: configuration.expectedHost,
    requestContext: context,
    inspectPullRequest: async (claims) => ({
      actor: claims.actor,
      repository: claims.repository,
      pullRequest: { ...claims.pullRequest, state: "OPEN" },
      scope: claims.scope,
    }),
    confirmPublication: async () => { throw new Error("Fixture forbids publication"); },
    publishReview: async () => { throw new Error("Fixture forbids provider mutation"); },
  });
  try {
    return await relayInetdRequest(server.url, request, context.signal);
  } finally {
    await server.close();
  }
}

function validateConfiguration(value) {
  if (!value || !path.isAbsolute(value.home ?? "") || !path.isAbsolute(value.traceFile ?? "")
    || !/^127[.]0[.]0[.]1:\d{1,5}$/.test(value.expectedHost ?? "")) {
    throw new Error("The launchd fixture configuration is invalid");
  }
  return Object.freeze({
    expectedHost: value.expectedHost,
    home: value.home,
    traceFile: value.traceFile,
  });
}

async function recordLifecycle(event) {
  await appendFile(configuration.traceFile, `${JSON.stringify({ event, pid: process.pid, time: Date.now() })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
