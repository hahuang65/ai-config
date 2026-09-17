#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readlink, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  SERVICE_SHUTDOWN_TIMEOUT_SECONDS,
  TOTAL_SERVICE_LIFETIME_SECONDS,
} from "../skills/review-change/runtime/review-publication-lifetime.mjs";

const MANAGED_MARKER = "Managed by ai-config: review-publication";
const WORKER_INTEGRITY_ERROR = "Review publication worker artifact integrity check failed";
const [mode, template, destination, nodeExecutable, worker, ghExecutable, legacyTarget = "", force = "false", confirmationExecutable = "", operation = "install"] = process.argv.slice(2);
const workerMode = mode === "worker";
if (!["launchd", "systemd", "worker", "worker-config", "wrapper"].includes(mode)
  || !destination
  || !nodeExecutable
  || !worker
  || !ghExecutable
  || !path.isAbsolute(destination)
  || workerMode && (!path.isAbsolute(template) || !path.isAbsolute(ghExecutable))
  || !workerMode && mode !== "wrapper" && !path.isAbsolute(confirmationExecutable)
  || !["true", "false"].includes(force)
  || !["install", "validate-only"].includes(operation)) {
  throw new Error("Invalid Review publication installation renderer arguments");
}

const legacyContent = workerMode
  ? await loadVerifiedWorkerArtifact(template, ghExecutable)
  : mode === "wrapper"
    ? renderWrapper(nodeExecutable, worker, ghExecutable)
    : mode === "worker-config"
      ? renderWorkerConfiguration(ghExecutable, confirmationExecutable)
      : renderTemplate(await readFile(template, "utf8"), mode, {
        nodeExecutable,
        worker,
        ghExecutable,
        confirmationExecutable,
      });
const content = workerMode ? legacyContent : markManagedContent(legacyContent, mode);
const options = {
  force: workerMode ? false : force === "true",
  legacyContent,
  legacyTarget,
  mode: mode === "wrapper" ? 0o755 : workerMode || mode === "worker-config" ? 0o600 : 0o644,
  privateParent: workerMode || mode === "worker-config",
  rejectSymlink: mode === "launchd" || workerMode || mode === "worker-config",
  requireExistingMode: workerMode,
  unsafeLabel: workerMode ? "Review publication worker" : mode === "launchd" ? "LaunchAgent" : "Managed service",
};
if (operation === "validate-only") await validateExistingManagedFile(destination, options);
else await installManagedFile(destination, content, options);

async function loadVerifiedWorkerArtifact(source, digestFile) {
  try {
    const sourceState = await lstat(source);
    if (!sourceState.isFile() || sourceState.isSymbolicLink()) throw workerIntegrityError();
    const [content, digestRecord] = await Promise.all([
      readFile(source, "utf8"),
      readFile(digestFile, "utf8"),
    ]);
    const expectedRecord = /^([a-f0-9]{64})  ([^/\r\n]+)\n$/.exec(digestRecord);
    const actualDigest = createHash("sha256").update(content).digest("hex");
    if (!expectedRecord || expectedRecord[2] !== path.basename(source) || expectedRecord[1] !== actualDigest) {
      throw workerIntegrityError();
    }
    return content;
  } catch (error) {
    if (error?.message === WORKER_INTEGRITY_ERROR) throw error;
    throw workerIntegrityError();
  }
}

function workerIntegrityError() {
  return new Error(WORKER_INTEGRITY_ERROR);
}

function renderTemplate(source, format, values) {
  const escape = format === "launchd" ? escapeXml : quoteSystemd;
  return source
    .replaceAll("__NODE_EXECUTABLE__", escape(values.nodeExecutable))
    .replaceAll("__WORKER__", escape(values.worker))
    .replaceAll("__GH_EXECUTABLE__", escape(values.ghExecutable))
    .replaceAll("__CONFIRMATION_EXECUTABLE__", escape(values.confirmationExecutable))
    .replaceAll("__SERVICE_LIFETIME_SECONDS__", String(TOTAL_SERVICE_LIFETIME_SECONDS))
    .replaceAll("__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__", String(SERVICE_SHUTDOWN_TIMEOUT_SECONDS));
}

function renderWrapper(nodeExecutable, worker, ghExecutable) {
  return `#!/bin/sh\nREVIEW_PUBLICATION_GH=${quoteShell(ghExecutable)} exec ${quoteShell(nodeExecutable)} ${quoteShell(worker)} "$@"\n`;
}

function renderWorkerConfiguration(githubExecutable, confirmationExecutable) {
  return `${JSON.stringify({
    managedBy: MANAGED_MARKER,
    version: 1,
    confirmationExecutable,
    githubExecutable,
  }, null, 2)}\n`;
}

function markManagedContent(content, format) {
  if (format === "launchd") {
    return content.replace("?>\n", `?>\n<!-- ${MANAGED_MARKER} -->\n`);
  }
  const marker = `# ${MANAGED_MARKER}`;
  if (format === "systemd") return `${marker}\n${content}`;
  if (format === "worker-config") return content;
  return content.replace("#!/bin/sh\n", `#!/bin/sh\n${marker}\n`);
}

async function validateExistingManagedFile(destination, options) {
  let state;
  try {
    state = await lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await validateSafeParent(path.dirname(destination), null, options.privateParent);
  await validateDestination(destination, options);
  return state;
}

async function installManagedFile(destination, content, options) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: options.privateParent ? 0o700 : undefined });
  const parentProof = await validateSafeParent(parent, null, options.privateParent);
  const original = await validateDestination(destination, options);
  const temporary = path.join(parent, `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, options.mode);
    await validateUnchangedDestination(destination, original, options);
    await validateSafeParent(parent, parentProof, options.privateParent);
    await rename(temporary, destination);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function validateSafeParent(parent, expected = null, privateParent = false) {
  const home = path.resolve(process.env.HOME ?? "");
  const resolvedParent = path.resolve(parent);
  const relative = path.relative(home, resolvedParent);
  if (!home || relative.startsWith("..") || path.isAbsolute(relative)) throw unsafeParentError();
  const [resolvedHome, realParent] = await Promise.all([realpath(home), realpath(resolvedParent)]);
  if (realParent !== path.resolve(resolvedHome, relative)) throw unsafeParentError();
  const paths = managedAncestorPaths(home, relative);
  const proof = [];
  for (const candidate of paths) {
    const state = await lstat(candidate);
    const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
    const finalDirectoryIsPublic = privateParent && candidate === parent && (state.mode & 0o077) !== 0;
    if (!state.isDirectory() || state.isSymbolicLink() || wrongOwner || (state.mode & 0o022) !== 0
      || finalDirectoryIsPublic) {
      throw unsafeParentError();
    }
    proof.push({ path: candidate, device: state.dev, inode: state.ino });
  }
  if (expected && JSON.stringify(proof) !== JSON.stringify(expected)) throw unsafeParentError();
  return proof;
}

function managedAncestorPaths(home, relative) {
  const paths = [home];
  let current = home;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths;
}

function unsafeParentError() {
  return new Error("Managed installation parent is unsafe");
}

async function validateDestination(destination, options) {
  const { force, legacyContent, rejectSymlink, legacyTarget, mode, requireExistingMode, unsafeLabel } = options;
  let state;
  try {
    state = await lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const wrongOwner = typeof process.getuid === "function" && state.uid !== process.getuid();
  if (state.isSymbolicLink()) {
    const expectedLegacyLink = !rejectSymlink && legacyTarget && await readlink(destination) === legacyTarget;
    if (!expectedLegacyLink && (!force || rejectSymlink || wrongOwner)) {
      throw new Error(unsafeDestinationMessage(unsafeLabel));
    }
  } else if (!state.isFile() || wrongOwner || requireExistingMode && (state.mode & 0o777) !== mode) {
    throw new Error(unsafeDestinationMessage(unsafeLabel));
  } else if (!force && !await isManagedFile(destination, legacyContent)) {
    throw new Error("Review publication destination is not managed; use --force to overwrite");
  }
  return { device: state.dev, inode: state.ino };
}

async function isManagedFile(destination, legacyContent) {
  const existingContent = await readFile(destination, "utf8");
  return existingContent.includes(MANAGED_MARKER) || existingContent === legacyContent;
}

async function validateUnchangedDestination(destination, original, options) {
  const current = await validateDestination(destination, options);
  if (current?.device !== original?.device || current?.inode !== original?.inode) {
    throw new Error("Managed service destination changed during installation");
  }
}

function unsafeDestinationMessage(label) {
  return `${label} destination is unsafe`;
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function quoteSystemd(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("Managed service path contains a forbidden control character");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function quoteShell(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("Managed executable path contains a forbidden control character");
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
