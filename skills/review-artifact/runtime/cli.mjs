import { realpath } from "node:fs/promises";

import { openBrowser as launchBrowser } from "./browser.mjs";
import { ensureReviewServer, stopReviewServer } from "./daemon.mjs";
import { sessionKey } from "./session-store.mjs";

export async function runReviewCommand(argv, dependencies = {}) {
  const normalized = normalizeArguments(argv);
  const command = normalized[0];
  if (!new Set(["open", "poll", "end", "stop"]).has(command)) {
    throw commandError(`Unknown command: ${command ?? ""}`);
  }
  if (command === "stop") return (dependencies.stopServer ?? stopReviewServer)();
  const ensureServer = dependencies.ensureServer ?? ensureReviewServer;
  const baseUrl = await ensureServer();
  if (command === "open") return openArtifact(normalized.slice(1), baseUrl, dependencies);
  if (command === "poll") return pollArtifact(normalized.slice(1), baseUrl, dependencies);
  if (command === "end") return endArtifact(normalized.slice(1), baseUrl);
  throw commandError(`Command is not implemented: ${command}`);
}

async function openArtifact(args, baseUrl, dependencies) {
  const file = firstPositional(args);
  if (!file) throw commandError("An HTML file path is required");
  const session = await postJson(`${baseUrl}/api/sessions`, { file, reopen: args.includes("--reopen") });
  const shouldOpen = !args.includes("--no-open") && process.env.REVIEW_ARTIFACT_NO_OPEN !== "1";
  if (shouldOpen && session.reopened !== false) await (dependencies.openBrowser ?? launchBrowser)(session.url);
  return {
    session: {
      file: session.file,
      url: session.url,
      status: session.status,
      ...(session.reopened === false ? { reopened: false } : {}),
    },
    nextStep: session.reopened === false
      ? "The user already finished this review. Do not reopen it without --reopen."
      : `Run review-artifact poll ${session.file} to wait for feedback or approval.`,
  };
}

async function endArtifact(args, baseUrl) {
  const file = firstPositional(args);
  if (!file) throw commandError("An HTML file path is required");
  const key = sessionKey(await realpath(file));
  return postJson(`${baseUrl}/api/sessions/${key}/end`, {});
}

async function pollArtifact(args, baseUrl, dependencies) {
  const file = firstPositional(args);
  if (!file) throw commandError("An HTML file path is required");
  const key = sessionKey(await realpath(file));
  const reply = flagValue(args, "--agent-reply");
  if (reply) await postJson(`${baseUrl}/api/sessions/${key}/agent-reply`, { text: reply });
  const writeStatus = dependencies.writeStatus ?? ((message) => process.stderr.write(`${message}\n`));
  writeStatus(`[review-artifact] Waiting for feedback or approval on ${await realpath(file)}. Retry if interrupted.`);
  return getJson(`${baseUrl}/api/sessions/${key}/poll`);
}

export function normalizeArguments(argv) {
  const first = argv[0];
  if (!first || first === "open" || first === "poll" || first === "end" || first === "stop") return argv;
  if (first.startsWith("-")) return argv;
  return ["open", ...argv];
}

function firstPositional(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--agent-reply") {
      index += 1;
      continue;
    }
    if (!args[index].startsWith("-")) return args[index];
  }
  return null;
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw commandError(payload.error?.message ?? `Request failed: ${response.status}`);
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw commandError(payload.error?.message ?? `Request failed: ${response.status}`);
  return payload;
}

function commandError(message) {
  return Object.assign(new Error(message), { code: "COMMAND_ERROR" });
}
