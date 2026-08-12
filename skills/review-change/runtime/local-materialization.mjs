import { constants } from "node:fs";
import { lstat, mkdir, open, readlink, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_DIRECTORY = "review-change-source-snapshot";
const COPY_BUFFER_BYTES = 64 * 1024;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export async function captureLocalSnapshot({ sourceRoot, workspace, readGitBuffer, signal }) {
  const trackedPatch = await readGitBuffer(["-C", sourceRoot, "diff", "--binary", "HEAD", "--"]);
  const snapshotRoot = path.join(workspace, ".git", SNAPSHOT_DIRECTORY);
  const untrackedPaths = await readUntrackedPaths(sourceRoot, readGitBuffer, signal);
  await mkdir(snapshotRoot, { recursive: true });
  for (const relativePath of untrackedPaths) {
    throwIfAborted(signal);
    await copySnapshotPath(sourceRoot, snapshotRoot, relativePath);
  }
  return { trackedPatch, snapshotRoot, untrackedPaths };
}

export async function replayLocalSnapshot({ workspace, snapshot, applyTrackedPatch, signal }) {
  if (snapshot.trackedPatch.length > 0) await applyTrackedPatch(snapshot.trackedPatch);
  for (const relativePath of snapshot.untrackedPaths) {
    throwIfAborted(signal);
    await copySnapshotPath(snapshot.snapshotRoot, workspace, relativePath);
  }
}

export async function clearReplayedUntracked({ workspace, snapshot, signal }) {
  for (const relativePath of snapshot.untrackedPaths) {
    throwIfAborted(signal);
    const destination = await resolveSafeDestination(workspace, relativePath, false);
    if (destination) await rm(destination, { force: true });
  }
}

async function readUntrackedPaths(sourceRoot, readGitBuffer, signal) {
  throwIfAborted(signal);
  const output = await readGitBuffer(["-C", sourceRoot, "ls-files", "--others", "--exclude-standard", "-z"]);
  return output.toString("utf8").split("\0").filter(Boolean);
}

async function copySnapshotPath(sourceRoot, destinationRoot, relativePath) {
  const source = safeChildPath(sourceRoot, relativePath);
  const sourceStat = await lstat(source);
  const destination = await resolveSafeDestination(destinationRoot, relativePath, true);
  if (sourceStat.isSymbolicLink()) {
    await copySafeSymbolicLink(source, destinationRoot, destination);
    return;
  }
  if (sourceStat.isFile()) {
    await copySafeFile(source, sourceStat, destinationRoot, relativePath);
    return;
  }
  throw new Error(`The untracked path cannot be represented safely: ${relativePath}`);
}

async function copySafeSymbolicLink(source, destinationRoot, destination) {
  const target = await readlink(source);
  assertSafeSymlinkTarget(destinationRoot, destination, target);
  await verifyDestinationParent(destinationRoot, destination);
  await symlink(target, destination);
  await verifyDestinationParent(destinationRoot, destination);
  const copiedTarget = await readlink(destination);
  if (copiedTarget !== target) throw new Error("The untracked symlink changed during replay");
}

async function copySafeFile(source, sourceStat, destinationRoot, relativePath) {
  const sourceHandle = await open(source, constants.O_RDONLY | NO_FOLLOW);
  let destinationHandle;
  try {
    assertSameFile(sourceStat, await sourceHandle.stat());
    const destination = await resolveSafeDestination(destinationRoot, relativePath, true);
    destinationHandle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      sourceStat.mode & 0o777,
    );
    await verifyDestinationParent(destinationRoot, destination);
    await copyFileHandles(sourceHandle, destinationHandle);
    await verifyDestinationParent(destinationRoot, destination);
  } finally {
    await Promise.allSettled([destinationHandle?.close(), sourceHandle.close()].filter(Boolean));
  }
}

async function copyFileHandles(sourceHandle, destinationHandle) {
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    let written = 0;
    while (written < bytesRead) {
      const writeResult = await destinationHandle.write(
        buffer,
        written,
        bytesRead - written,
        position + written,
      );
      if (writeResult.bytesWritten === 0) throw new Error("The untracked destination stopped accepting data");
      written += writeResult.bytesWritten;
    }
    position += bytesRead;
  }
}

async function resolveSafeDestination(root, relativePath, createParents) {
  const canonicalRoot = await canonicalDestinationRoot(root);
  const destination = safeChildPath(canonicalRoot, relativePath);
  const parentSegments = path.relative(canonicalRoot, path.dirname(destination)).split(path.sep).filter(Boolean);
  let currentParent = canonicalRoot;
  for (const segment of parentSegments) {
    currentParent = path.join(currentParent, segment);
    const parentStat = await lstat(currentParent).catch(missingPath);
    if (!parentStat) {
      if (!createParents) return null;
      await mkdir(currentParent);
    }
    await assertSafeDirectory(canonicalRoot, currentParent);
  }
  return destination;
}

async function verifyDestinationParent(root, destination) {
  const canonicalRoot = await canonicalDestinationRoot(root);
  const relativePath = path.relative(canonicalRoot, destination);
  const verifiedDestination = await resolveSafeDestination(canonicalRoot, relativePath, false);
  if (verifiedDestination !== destination) throw new Error("The untracked destination changed during replay");
}

async function canonicalDestinationRoot(root) {
  const expectedRoot = path.resolve(root);
  const canonicalRoot = await realpath(expectedRoot);
  if (canonicalRoot !== expectedRoot) {
    throw new Error("The untracked destination root changed during replay");
  }
  return canonicalRoot;
}

async function assertSafeDirectory(canonicalRoot, directory) {
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink()) {
    throw new Error("The untracked destination ancestor is a symbolic link");
  }
  if (!directoryStat.isDirectory()) throw new Error("The untracked destination ancestor is not a directory");
  const canonicalDirectory = await realpath(directory);
  if (!isPathWithin(canonicalRoot, canonicalDirectory)) {
    throw new Error("The untracked destination ancestor resolves outside the workspace");
  }
}

function assertSafeSymlinkTarget(root, destination, target) {
  if (path.isAbsolute(target)) throw new Error("The captured untracked symlink points outside the workspace");
  const resolvedTarget = path.resolve(path.dirname(destination), target);
  if (!isPathWithin(path.resolve(root), resolvedTarget)) {
    throw new Error("The captured untracked symlink points outside the workspace");
  }
}

function assertSameFile(expected, actual) {
  if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("The untracked source path changed during capture");
  }
}

function missingPath(error) {
  if (error?.code !== "ENOENT") throw error;
  return null;
}

function safeChildPath(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  if (!isPathWithin(path.resolve(root), candidate)) throw new Error("Git returned an unsafe path");
  return candidate;
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("workspace creation interrupted"), { name: "AbortError" });
}
