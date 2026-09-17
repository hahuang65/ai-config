import crypto from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, rmdir, unlink, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CLEANUP_TIMEOUT_MS,
  LOCK_WAIT_TIMEOUT_MS,
} from "./review-publication-lifetime.mjs";
const DEFAULT_STALE_THRESHOLD_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const KEY_BYTES = 32;
const KEY_TEMPORARY_PREFIX = ".signing-key.";
const KEY_TEMPORARY_SUFFIX = ".tmp";
const LEASE_SUFFIX = ".lease";

export async function loadPublicationKey({
  home = os.homedir(),
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  now = () => Date.now(),
} = {}) {
  const directory = await stateDirectory(home);
  const destination = path.join(directory, "signing-key");
  await removeStaleKeyTemporaries(directory, staleThresholdMs, now);
  try {
    return await readPublicationKey(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return initializePublicationKey(directory, destination);
    if (!error?.publicationKeyIncomplete || now() - error.state.mtimeMs <= staleThresholdMs) throw error;
    return recoverIncompletePublicationKey(directory, destination);
  }
}

async function initializePublicationKey(directory, destination) {
  const temporary = path.join(
    directory,
    `${KEY_TEMPORARY_PREFIX}${process.pid}.${crypto.randomUUID()}${KEY_TEMPORARY_SUFFIX}`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(crypto.randomBytes(KEY_BYTES));
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, destination);
      await syncDirectory(directory);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    return await readPublicationKey(destination);
  } finally {
    await handle?.close();
    if (await unlinkIfPresent(temporary)) await syncDirectory(directory);
  }
}

async function readPublicationKey(destination) {
  const handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = await handle.stat();
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || (state.mode & 0o077) !== 0 || wrongOwner) {
      throw new Error("Review publication signing key is unsafe");
    }
    const key = await handle.readFile();
    if (key.length !== KEY_BYTES) {
      throw Object.assign(new Error("Review publication signing key is invalid"), {
        publicationKeyIncomplete: key.length < KEY_BYTES,
        state,
      });
    }
    return key;
  } finally {
    await handle.close();
  }
}

async function recoverIncompletePublicationKey(directory, destination) {
  const quarantine = path.join(
    directory,
    `${KEY_TEMPORARY_PREFIX}recovery.${process.pid}.${crypto.randomUUID()}${KEY_TEMPORARY_SUFFIX}`,
  );
  try {
    await rename(destination, quarantine);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return initializePublicationKey(directory, destination);
  }
  try {
    try {
      await readPublicationKey(quarantine);
      try {
        await link(quarantine, destination);
        await syncDirectory(directory);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      return await readPublicationKey(destination);
    } catch (error) {
      if (!error?.publicationKeyIncomplete) throw error;
    }
  } finally {
    if (await unlinkIfPresent(quarantine)) await syncDirectory(directory);
  }
  return initializePublicationKey(directory, destination);
}

async function removeStaleKeyTemporaries(directory, staleThresholdMs, now) {
  const names = await readdir(directory);
  for (const name of names) {
    if (!name.startsWith(KEY_TEMPORARY_PREFIX) || !name.endsWith(KEY_TEMPORARY_SUFFIX)) continue;
    const candidate = path.join(directory, name);
    const state = await lstatIfPresent(candidate);
    if (!state) continue;
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || state.isSymbolicLink() || wrongOwner || (state.mode & 0o077) !== 0) {
      throw new Error("Review publication signing key initialization artifact is unsafe");
    }
    if (now() - state.mtimeMs <= staleThresholdMs) continue;
    const current = await lstatIfPresent(candidate);
    if (current?.dev === state.dev && current.ino === state.ino && current.mtimeMs === state.mtimeMs) {
      if (await unlinkIfPresent(candidate)) await syncDirectory(directory);
    }
  }
}

async function lstatIfPresent(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function unlinkIfPresent(candidate) {
  try {
    await unlink(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code)) throw error;
  } finally {
    await handle.close();
  }
}

export async function withPublisherLock(identity, task, {
  home = os.homedir(),
  now = () => Date.now(),
  sleep = sleepFor,
  ownerToken = crypto.randomUUID(),
  waitTimeoutMs = LOCK_WAIT_TIMEOUT_MS,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  refreshIntervalMs = Math.max(1, Math.floor(staleThresholdMs / 3)),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
  onCleanupFailure = () => {},
  releaseLease = releaseOwnedLease,
  signal,
} = {}) {
  throwIfCancelled(signal);
  const directory = await stateDirectory(home);
  const lock = path.join(directory, `publisher-${publicationIdentityDigest(identity)}.lock`);
  const lease = path.join(lock, `${ownerToken}${LEASE_SUFFIX}`);
  const deadline = now() + waitTimeoutMs;
  await acquireLease({ deadline, lease, lock, now, ownerToken, pollIntervalMs, signal, sleep, staleThresholdMs });
  const heartbeat = startLeaseHeartbeat(lease, refreshIntervalMs);
  let taskFailed = false;
  let taskError;
  let taskValue;
  try {
    throwIfCancelled(signal);
    taskValue = await task();
  } catch (error) {
    taskFailed = true;
    taskError = error;
  }
  try {
    await boundedLockCleanup(heartbeat, lock, lease, cleanupTimeoutMs, releaseLease);
  } catch {
    try { await onCleanupFailure(); } catch {}
  }
  if (taskFailed) throw taskError;
  return taskValue;
}

async function boundedLockCleanup(heartbeat, lock, lease, timeoutMs, releaseLease) {
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => rejectDeadline(new Error("Review publisher lock cleanup timed out")), timeoutMs);
  timer.unref?.();
  try {
    await Promise.race([
      heartbeat.stop().then(() => releaseLease(lock, lease)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function acquireLease(options) {
  while (true) {
    try {
      await mkdir(options.lock, { mode: 0o700 });
      const handle = await open(options.lease, "wx", 0o600);
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await releaseOwnedLease(options.lock, options.lease);
        throw error;
      }
    }
    await inspectExistingLock(options);
    if (options.now() >= options.deadline) throw publisherBusyError();
    await options.sleep(options.pollIntervalMs, options.signal);
    throwIfCancelled(options.signal);
  }
}

async function inspectExistingLock({ lock, now, staleThresholdMs }) {
  let lockState;
  let entries;
  try {
    [lockState, entries] = await Promise.all([lstat(lock), readdir(lock, { withFileTypes: true })]);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!lockState.isDirectory() || lockState.isSymbolicLink()) throw new Error("Review publisher lock is unsafe");
  if (entries.length === 0) {
    if (now() - lockState.mtimeMs > staleThresholdMs) await removeEmptyLock(lock);
    return;
  }
  if (entries.length !== 1 || !entries[0].isFile() || entries[0].isSymbolicLink()
    || !entries[0].name.endsWith(LEASE_SUFFIX)) {
    throw new Error("Review publisher lock is unsafe");
  }
  const lease = path.join(lock, entries[0].name);
  const leaseState = await safeLeaseState(lease);
  if (leaseState && now() - leaseState.mtimeMs > staleThresholdMs) {
    await removeStaleLease(lock, lease, leaseState);
  }
}

async function removeStaleLease(lock, lease, observedState) {
  const currentState = await safeLeaseState(lease);
  if (!currentState || currentState.dev !== observedState.dev || currentState.ino !== observedState.ino
    || currentState.mtimeMs !== observedState.mtimeMs) return;
  try {
    await unlink(lease);
    await removeEmptyLock(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
  }
}

function startLeaseHeartbeat(lease, refreshIntervalMs) {
  let stopped = false;
  let timer;
  let refresh = Promise.resolve();
  const schedule = () => {
    timer = setTimeout(() => {
      const refreshedAt = new Date();
      refresh = utimes(lease, refreshedAt, refreshedAt).catch(() => {}).finally(() => {
        if (!stopped) schedule();
      });
    }, refreshIntervalMs);
    timer.unref?.();
  };
  schedule();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await refresh;
    },
  };
}

async function releaseOwnedLease(lock, lease) {
  try {
    await unlink(lease);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await removeEmptyLock(lock);
}

async function removeEmptyLock(lock) {
  try {
    await rmdir(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
  }
}

async function safeLeaseState(lease) {
  try {
    const state = await lstat(lease);
    if (!state.isFile() || state.isSymbolicLink()) throw new Error("Review publisher lock is unsafe");
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sleepFor(duration, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancellationError());
    const timer = setTimeout(finish, duration);
    const cancel = () => finish(cancellationError());
    signal?.addEventListener("abort", cancel, { once: true });
    function finish(error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve();
    }
  });
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

function cancellationError() {
  return Object.assign(new Error("Review publication request timed out"), {
    code: "request_timeout",
    status: 504,
  });
}

function publisherBusyError() {
  return Object.assign(new Error("Another Review publication is still running"), {
    code: "publisher_busy",
    status: 409,
  });
}

function publicationIdentityDigest(identity) {
  const values = [
    identity?.host,
    identity?.reportId,
    identity?.actor?.id,
    identity?.repository?.id,
    identity?.repository?.nameWithOwner,
    identity?.pullRequest?.id,
    identity?.pullRequest?.number,
    identity?.scope?.baseOid,
    identity?.scope?.headOid,
  ];
  if (values.some((value) => !["string", "number"].includes(typeof value))) {
    throw new Error("Review publication identity is invalid");
  }
  return crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

async function stateDirectory(home) {
  const directory = path.join(home, ".review-publication");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = await lstat(directory);
  const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || wrongOwner) {
    throw new Error("Review publication state directory is unsafe");
  }
  return directory;
}
