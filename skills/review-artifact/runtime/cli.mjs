import { realpath } from "node:fs/promises";

import { parseReviewInvocation } from "./arguments.mjs";
import { openBrowser as launchBrowser } from "./browser.mjs";
import { ensureReviewServer, stopReviewServer } from "./daemon.mjs";
import { sessionKey } from "./session-store.mjs";
import { AGENT_TOKEN_HEADER } from "./protocol.mjs";
import { credentialRedactedPreview } from "../../shared/runtime/safe-preview.mjs";

export async function runReviewCommand(argv, dependencies = {}) {
  const invocation = parseReviewInvocation(argv);
  if (invocation.type === "help") return invocation;
  const { command } = invocation;
  if (command === "stop") return (dependencies.stopServer ?? stopReviewServer)();
  const ensureServer = dependencies.ensureServer ?? ensureReviewServer;
  const connection = normalizeConnection(await ensureServer(), dependencies.agentToken);
  if (command === "open") return openArtifact(invocation, connection.baseUrl, dependencies);
  if (command === "poll") return pollArtifact(invocation, connection, dependencies);
  return endArtifact(invocation.file, connection);
}

async function openArtifact({ file, purpose, reopen, noOpen }, baseUrl, dependencies) {
  const session = await postJson(`${baseUrl}/api/sessions`, { file, purpose, reopen });
  const shouldOpen = !noOpen && process.env.REVIEW_ARTIFACT_NO_OPEN !== "1";
  if (shouldOpen && session.reopened !== false) await (dependencies.openBrowser ?? launchBrowser)(session.url);
  return {
    session: {
      file: session.file,
      url: session.url,
      status: session.status,
      purpose: session.purpose,
      mode: session.mode,
      ...(session.reopened === false ? { reopened: false } : {}),
    },
    nextStep: session.reopened === false
      ? "The user already finished this review. Do not reopen it without --reopen."
      : `Run review-artifact poll ${session.file} to wait for review activity.`,
  };
}

async function endArtifact(file, connection) {
  const key = sessionKey(await realpath(file));
  return postJson(`${connection.baseUrl}/api/sessions/${key}/end`, {}, connection.agentToken);
}

async function pollArtifact({ file, reply }, connection, dependencies) {
  const resolvedFile = await realpath(file);
  const key = sessionKey(resolvedFile);
  if (reply) {
    await postJson(`${connection.baseUrl}/api/sessions/${key}/agent-reply`, { text: reply }, connection.agentToken);
  }
  const writeStatus = dependencies.writeStatus ?? ((message) => process.stderr.write(`${message}\n`));
  const status = `[review-artifact] Waiting for feedback or approval on ${resolvedFile}. Retry if interrupted.`;
  writeStatus(credentialRedactedPreview(status, 300).text);
  return getJson(`${connection.baseUrl}/api/sessions/${key}/poll`, connection.agentToken);
}

function normalizeConnection(connection, fallbackToken) {
  if (typeof connection === "string") return { baseUrl: connection, agentToken: fallbackToken };
  return connection;
}

async function getJson(url, agentToken) {
  const response = await fetch(url, { headers: agentHeaders(agentToken) });
  const payload = await response.json();
  if (!response.ok) throw commandError(payload.error?.message ?? `Request failed: ${response.status}`);
  return payload;
}

async function postJson(url, body, agentToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...agentHeaders(agentToken) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw commandError(payload.error?.message ?? `Request failed: ${response.status}`);
  return payload;
}

function agentHeaders(agentToken) {
  return agentToken ? { [AGENT_TOKEN_HEADER]: agentToken } : {};
}

function commandError(message) {
  return Object.assign(new Error(message), { code: "COMMAND_ERROR" });
}
