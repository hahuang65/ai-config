import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { reviewPort, serverBaseUrl, serverLogFile, stateDirectory } from "./paths.mjs";

const STARTUP_TIMEOUT_MS = 5_000;

export async function ensureReviewServer(env = process.env) {
  const baseUrl = serverBaseUrl(env);
  const health = await fetchHealth(baseUrl);
  if (health?.app === "review-artifact") return baseUrl;
  if (health) throw new Error(`Port ${reviewPort(env)} is occupied by another server`);

  await mkdir(stateDirectory(env), { recursive: true, mode: 0o700 });
  startDetachedServer(env);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(100);
    const started = await fetchHealth(baseUrl);
    if (started?.app === "review-artifact") return baseUrl;
    if (started) throw new Error(`Port ${reviewPort(env)} was claimed by another server`);
  }
  throw new Error(`Review server did not start; inspect ${serverLogFile(env)}`);
}

export async function stopReviewServer(env = process.env) {
  const baseUrl = serverBaseUrl(env);
  const health = await fetchHealth(baseUrl);
  if (!health) return { status: "not-running", port: reviewPort(env) };
  if (health.app !== "review-artifact") throw new Error(`Port ${reviewPort(env)} is occupied by another server`);
  const response = await fetch(`${baseUrl}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1_000) });
  if (!response.ok) throw new Error("Review server refused to stop");
  return { status: "stopping", port: reviewPort(env) };
}

export async function fetchHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function startDetachedServer(env) {
  mkdirSync(stateDirectory(env), { recursive: true, mode: 0o700 });
  const log = openSync(serverLogFile(env), "a", 0o600);
  const entry = fileURLToPath(new URL("../bin/review-artifact.mjs", import.meta.url));
  try {
    const child = spawn(process.execPath, [entry, "server"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...env, REVIEW_ARTIFACT_NO_OPEN: "1" },
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
