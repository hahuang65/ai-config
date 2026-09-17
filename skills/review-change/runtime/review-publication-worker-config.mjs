import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIGURATION_VERSION = 1;
const MAX_CONFIGURATION_BYTES = 16 * 1024;
const MANAGED_BY = "Managed by ai-config: review-publication";
const CONFIGURATION_KEYS = [
  "confirmationExecutable",
  "githubExecutable",
  "managedBy",
  "version",
];

export async function loadReviewPublicationWorkerConfiguration({
  home = os.homedir(),
  runtimePlatform = process.platform,
} = {}) {
  const platform = supportedPlatform(runtimePlatform);
  const directory = path.join(home, ".review-publication");
  await validatePrivateDirectory(directory);
  const configuration = await readPrivateConfiguration(path.join(directory, "worker-config.json"));
  validateConfiguration(configuration);
  return {
    confirmationExecutable: configuration.confirmationExecutable,
    githubExecutable: configuration.githubExecutable,
    platform,
  };
}

async function validatePrivateDirectory(directory) {
  const state = await lstat(directory);
  const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || wrongOwner || (state.mode & 0o077) !== 0) {
    throw new Error("Review publication worker configuration directory is unsafe");
  }
}

async function readPrivateConfiguration(configurationPath) {
  const handle = await open(configurationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = await handle.stat();
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    if (!state.isFile() || wrongOwner || (state.mode & 0o077) !== 0 || state.size > MAX_CONFIGURATION_BYTES) {
      throw new Error("Review publication worker configuration is unsafe");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

function validateConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)
    || JSON.stringify(Object.keys(configuration).sort()) !== JSON.stringify(CONFIGURATION_KEYS)
    || configuration.version !== CONFIGURATION_VERSION
    || configuration.managedBy !== MANAGED_BY
    || !absoluteSafePath(configuration.confirmationExecutable)
    || !absoluteSafePath(configuration.githubExecutable)) {
    throw new Error("Review publication worker configuration is invalid");
  }
}

function absoluteSafePath(candidate) {
  return typeof candidate === "string"
    && path.isAbsolute(candidate)
    && !/[\u0000-\u001f\u007f]/.test(candidate);
}

function supportedPlatform(runtimePlatform) {
  if (runtimePlatform === "darwin") return "macos";
  if (runtimePlatform === "linux") return "linux";
  throw new Error(`Review publication is unsupported on ${runtimePlatform}`);
}
