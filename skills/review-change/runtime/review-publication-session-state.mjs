import crypto from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SESSION_STATE_BYTES = 64 * 1024;
const PRIVATE_MODE_MASK = 0o077;
const CURRENT_SUFFIX = ".current.json";
const PREPARED_PREFIX = ".prepared-";
const PREPARED_SUFFIX = ".json";

export async function beginClaudePublicationInvocation(
  sessionId,
  invocationMarker,
  { home = os.homedir() } = {},
) {
  validateInvocationMarker(invocationMarker);
  const root = await ensurePrivateStateRoot(home);
  await replacePrivateJson(currentStatePath(root, sessionId), {
    sessionBinding: sessionBinding(sessionId),
    invocationMarker,
  });
}

export async function saveClaudePublicationSession(
  sessionId,
  prepared,
  { home = os.homedir(), invocationMarker } = {},
) {
  validateInvocationMarker(invocationMarker);
  const root = await ensurePrivateStateRoot(home);
  await requireCurrentMarker(root, sessionId, invocationMarker);
  const destination = preparedStatePath(root, sessionId, invocationMarker);
  await replacePrivateJson(destination, {
    sessionBinding: sessionBinding(sessionId),
    invocationMarker,
    prepared,
  });
  await requireCurrentMarker(root, sessionId, invocationMarker);
}

export async function loadClaudePublicationSession(sessionId, { home = os.homedir() } = {}) {
  const root = await ensurePrivateStateRoot(home);
  const current = await readCurrentState(root, sessionId);
  if (!current) return undefined;
  const preparedPath = preparedStatePath(root, sessionId, current.invocationMarker);
  const saved = await readPrivateJsonIfPresent(preparedPath);
  if (!saved) return undefined;
  validateSavedPrepared(saved, sessionId, current.invocationMarker);
  await requireCurrentMarker(root, sessionId, current.invocationMarker);
  return saved.prepared;
}

export async function removeClaudePublicationSession(
  sessionId,
  { home = os.homedir(), currentInvocationMarker } = {},
) {
  const root = await ensurePrivateStateRoot(home);
  const binding = sessionBinding(sessionId);
  if (currentInvocationMarker !== undefined) {
    validateInvocationMarker(currentInvocationMarker);
    await requireCurrentMarker(root, sessionId, currentInvocationMarker);
    await removePreparedFiles(root, binding, markerBinding(currentInvocationMarker));
    return;
  }
  await rm(currentStatePath(root, sessionId), { force: true });
  await removePreparedFiles(root, binding);
}

async function removePreparedFiles(root, binding, preservedMarkerBinding) {
  const prefix = `${binding}${PREPARED_PREFIX}`;
  for (const name of await readdir(root)) {
    if (!name.startsWith(prefix) || !name.endsWith(PREPARED_SUFFIX)) continue;
    if (preservedMarkerBinding && name === `${prefix}${preservedMarkerBinding}${PREPARED_SUFFIX}`) continue;
    await rm(path.join(root, name), { force: true });
  }
}

async function requireCurrentMarker(root, sessionId, invocationMarker) {
  const current = await readCurrentState(root, sessionId);
  if (!current || current.invocationMarker !== invocationMarker) {
    throw new Error("Review publication invocation was superseded");
  }
}

async function readCurrentState(root, sessionId) {
  const saved = await readPrivateJsonIfPresent(currentStatePath(root, sessionId));
  if (!saved) return undefined;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
    || saved.sessionBinding !== sessionBinding(sessionId)) {
    throw new Error("Review publication session state does not belong to this Claude Code session");
  }
  validateInvocationMarker(saved.invocationMarker);
  return saved;
}

function validateSavedPrepared(saved, sessionId, invocationMarker) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
    || saved.sessionBinding !== sessionBinding(sessionId)
    || saved.invocationMarker !== invocationMarker
    || !("prepared" in saved)) {
    throw new Error("Review publication session state does not belong to this Claude Code invocation");
  }
}

async function readPrivateJsonIfPresent(statePath) {
  let handle;
  try {
    handle = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const state = await handle.stat();
    if (!state.isFile() || state.size > MAX_SESSION_STATE_BYTES || (state.mode & PRIVATE_MODE_MASK) !== 0) {
      throw new Error("Review publication session state is invalid");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function replacePrivateJson(destination, value) {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function ensurePrivateStateRoot(home) {
  const root = path.join(home, ".claude", "review-publication-sessions");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const state = await lstat(root);
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & PRIVATE_MODE_MASK) !== 0) {
    throw new Error("Review publication session directory must be private");
  }
  return root;
}

function currentStatePath(root, sessionId) {
  return path.join(root, `${sessionBinding(sessionId)}${CURRENT_SUFFIX}`);
}

function preparedStatePath(root, sessionId, invocationMarker) {
  return path.join(
    root,
    `${sessionBinding(sessionId)}${PREPARED_PREFIX}${markerBinding(invocationMarker)}${PREPARED_SUFFIX}`,
  );
}

function sessionBinding(sessionId) {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256 || /\p{Cc}/u.test(sessionId)) {
    throw new Error("Review publication requires a valid harness session");
  }
  return crypto.createHash("sha256").update(sessionId).digest("hex");
}

function markerBinding(invocationMarker) {
  return crypto.createHash("sha256").update(invocationMarker).digest("hex");
}

function validateInvocationMarker(invocationMarker) {
  if (typeof invocationMarker !== "string" || !invocationMarker || invocationMarker.length > 256
    || /\p{Cc}/u.test(invocationMarker)) {
    throw new Error("Review publication requires a valid invocation marker");
  }
}
