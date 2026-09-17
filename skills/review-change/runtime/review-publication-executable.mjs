import { accessSync, constants, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const UNSAFE_WRITE_MODE = 0o022;
const GROUP_WRITE_MODE = 0o020;
const WORLD_WRITE_MODE = 0o002;
const STICKY_MODE = 0o1000;

export function resolveGitHubCliPath({ candidate, environment = process.env } = {}) {
  const selected = candidate ?? findGitHubCliOnPath(environment.PATH);
  return validateGitHubCliPath(selected);
}

export function validateGitHubCliPath(executable, {
  userId = typeof process.getuid === "function" ? process.getuid() : 0,
} = {}) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw new Error("GitHub CLI must resolve to an absolute executable path");
  }
  if (/[\u0000-\u001f\u007f]/.test(executable)) throw new Error("GitHub CLI path is unsafe");
  try {
    const candidateState = lstatSync(executable);
    const resolved = candidateState.isSymbolicLink()
      ? validateHomebrewLink(executable)
      : realpathSync(executable);
    const state = statSync(resolved);
    if (!state.isFile()) throw new Error("not a file");
    accessSync(resolved, constants.X_OK);
    if ((state.mode & UNSAFE_WRITE_MODE) !== 0) throw new Error("unsafe path");
    validateAncestors(resolved, userId);
    return candidateState.isSymbolicLink() ? executable : resolved;
  } catch (error) {
    if (error?.message === "unsafe path") throw new Error("GitHub CLI absolute executable path is unsafe");
    throw new Error("GitHub CLI absolute executable is not an executable file");
  }
}

export function validateTrustedExecutablePath(executable, {
  userId = typeof process.getuid === "function" ? process.getuid() : 0,
} = {}) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)
    || /[\u0000-\u001f\u007f]/.test(executable)) {
    throw new Error("Trusted executable path is unsafe");
  }
  try {
    const candidateState = lstatSync(executable);
    if (candidateState.isSymbolicLink()) throw new Error("unsafe path");
    const resolved = realpathSync(executable);
    const state = statSync(resolved);
    if (!state.isFile() || (state.mode & UNSAFE_WRITE_MODE) !== 0) throw new Error("unsafe path");
    accessSync(resolved, constants.X_OK);
    validateAncestors(resolved, userId);
    return resolved;
  } catch {
    throw new Error("Trusted executable is not a safe executable file");
  }
}

function findGitHubCliOnPath(pathValue) {
  if (typeof pathValue !== "string" || !pathValue) {
    throw new Error("GitHub CLI could not be resolved from PATH");
  }
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory) || /[\u0000-\u001f\u007f]/.test(directory)) {
      throw new Error("GitHub CLI PATH contains an unsafe directory");
    }
    const candidate = path.join(directory, "gh");
    try {
      statSync(candidate);
      return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    }
  }
  throw new Error("GitHub CLI could not be resolved from PATH");
}

function validateHomebrewLink(executable) {
  const bin = path.dirname(executable);
  const prefix = path.dirname(bin);
  const target = readlinkSync(executable);
  const segments = target.split(path.sep);
  const version = segments[3];
  const exactShape = path.basename(executable) === "gh"
    && path.basename(bin) === "bin"
    && segments.length === 6
    && segments[0] === ".."
    && segments[1] === "Cellar"
    && segments[2] === "gh"
    && safeVersion(version)
    && segments[4] === "bin"
    && segments[5] === "gh";
  if (!exactShape) throw new Error("unsafe path");
  const expected = path.join(prefix, "Cellar", "gh", version, "bin", "gh");
  const resolved = realpathSync(executable);
  if (resolved !== realpathSync(expected)) throw new Error("unsafe path");
  return resolved;
}

function safeVersion(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
}

function validateAncestors(executable, userId) {
  const allowedOwners = new Set([0, userId]);
  let current = path.dirname(executable);
  while (true) {
    const state = statSync(current);
    const worldWritable = (state.mode & WORLD_WRITE_MODE) !== 0;
    const groupWritable = (state.mode & GROUP_WRITE_MODE) !== 0;
    const safeStickyDirectory = worldWritable && (state.mode & STICKY_MODE) !== 0;
    if (!state.isDirectory() || !allowedOwners.has(state.uid)
      || (worldWritable && !safeStickyDirectory)
      || (!worldWritable && groupWritable && state.uid !== userId)) {
      throw new Error("unsafe path");
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
