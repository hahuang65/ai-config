import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  reviewPort,
  serverBaseUrl,
  serverLockDirectory,
  serverLogFile,
  serverMetadataFile,
  stateDirectory,
} from "./paths.mjs";
import {
  AGENT_TOKEN_HEADER,
  createAgentToken,
  REVIEW_ARTIFACT_APP,
  REVIEW_ARTIFACT_RUNTIME_VERSION,
} from "./protocol.mjs";

const STARTUP_TIMEOUT_MS = 5_000;

export async function ensureReviewServer(env = process.env) {
  await mkdir(stateDirectory(env), { recursive: true, mode: 0o700 });
  const release = await acquireStartupLock(env);
  try {
    return await ensureReviewServerLocked(env);
  } finally {
    await release();
  }
}

async function ensureReviewServerLocked(env) {
  const baseUrl = serverBaseUrl(env);
  const health = await fetchHealth(baseUrl);
  if (compatibleHealth(health)) {
    return { baseUrl, agentToken: await readAgentToken(env) };
  }
  if (health?.app === REVIEW_ARTIFACT_APP) {
    const previousToken = await readAgentToken(env, { required: false });
    await stopRunningServer(baseUrl, previousToken);
    await waitForServerStop(baseUrl);
  } else if (health) {
    throw new Error(`Port ${reviewPort(env)} is occupied by another server`);
  }

  const agentToken = createAgentToken();
  await writeServerMetadata(env, { agentToken, runtimeVersion: REVIEW_ARTIFACT_RUNTIME_VERSION });
  startDetachedServer(env, agentToken);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(100);
    const started = await fetchHealth(baseUrl);
    if (compatibleHealth(started)) return { baseUrl, agentToken };
    if (started) throw new Error(`Port ${reviewPort(env)} was claimed by another server`);
  }
  throw new Error(`Review server did not start; inspect ${serverLogFile(env)}`);
}

export async function stopReviewServer(env = process.env) {
  const baseUrl = serverBaseUrl(env);
  const health = await fetchHealth(baseUrl);
  if (!health) return { status: "not-running", port: reviewPort(env) };
  if (health.app !== REVIEW_ARTIFACT_APP) throw new Error(`Port ${reviewPort(env)} is occupied by another server`);
  const agentToken = await readAgentToken(env, { required: false });
  await stopRunningServer(baseUrl, agentToken);
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

function compatibleHealth(health) {
  return health?.app === REVIEW_ARTIFACT_APP && health.version === REVIEW_ARTIFACT_RUNTIME_VERSION;
}

async function stopRunningServer(baseUrl, agentToken) {
  const response = await fetch(`${baseUrl}/shutdown`, {
    method: "POST",
    headers: agentToken ? { [AGENT_TOKEN_HEADER]: agentToken } : {},
    signal: AbortSignal.timeout(1_000),
  });
  if (!response.ok) throw new Error("Review server refused to stop");
}

async function waitForServerStop(baseUrl) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(50);
    if (!(await fetchHealth(baseUrl))) return;
  }
  throw new Error("Incompatible review server did not stop");
}

async function acquireStartupLock(env) {
  const lockDirectory = serverLockDirectory(env);
  const staleAfter = STARTUP_TIMEOUT_MS * 3;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      return async () => {
        await rmdir(lockDirectory).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const details = await stat(lockDirectory).catch(() => null);
      if (details && Date.now() - details.mtimeMs > staleAfter) {
        await rmdir(lockDirectory).catch(() => {});
      } else {
        await delay(50);
      }
    }
  }
}

async function readAgentToken(env, { required = true } = {}) {
  try {
    const metadata = JSON.parse(await readFile(serverMetadataFile(env), "utf8"));
    if (typeof metadata.agentToken === "string" && metadata.agentToken) return metadata.agentToken;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!required) return null;
  throw new Error("Review server authentication metadata is missing");
}

async function writeServerMetadata(env, metadata) {
  const destination = serverMetadataFile(env);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

function startDetachedServer(env, agentToken) {
  mkdirSync(stateDirectory(env), { recursive: true, mode: 0o700 });
  const log = openSync(serverLogFile(env), "a", 0o600);
  const entry = fileURLToPath(new URL("../bin/review-artifact.mjs", import.meta.url));
  try {
    const child = spawn(process.execPath, [entry, "server"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...env, REVIEW_ARTIFACT_AGENT_TOKEN: agentToken, REVIEW_ARTIFACT_NO_OPEN: "1" },
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
