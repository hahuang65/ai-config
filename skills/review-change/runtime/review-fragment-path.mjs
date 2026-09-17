import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function validateReviewFragmentDestination(candidate, {
  repositoryRoot,
  temporaryRoot = tmpdir(),
} = {}) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) throw unsafeDestination();
  if (candidate.split(path.sep).some((segment) => segment === "." || segment === "..")) {
    throw unsafeDestination();
  }

  const configuredRoot = path.resolve(temporaryRoot);
  const canonicalRoot = await realpath(configuredRoot);
  const parent = path.dirname(candidate);
  const canonicalParent = await realpath(parent);
  if (!isWithin(canonicalRoot, canonicalParent)) throw unsafeDestination();

  const configuredRootAncestors = new Set(ancestorPaths(configuredRoot));
  for (const ancestor of ancestorPaths(parent)) {
    const state = await lstat(ancestor);
    if (!state.isDirectory() && !state.isSymbolicLink()) throw unsafeDestination();
    if (!state.isSymbolicLink()) continue;
    const resolved = await realpath(ancestor);
    const platformAlias = configuredRootAncestors.has(ancestor) && isWithin(resolved, canonicalRoot);
    if (!platformAlias) throw unsafeDestination();
  }

  const destinationState = await lstatIfPresent(candidate);
  if (destinationState?.isSymbolicLink() || destinationState && !destinationState.isFile()) {
    throw unsafeDestination();
  }

  const canonicalDestination = path.join(canonicalParent, path.basename(candidate));
  if (repositoryRoot) {
    const canonicalRepository = await realpath(repositoryRoot);
    if (isWithin(canonicalRepository, canonicalDestination)) throw unsafeDestination();
  }
  return canonicalDestination;
}

function ancestorPaths(candidate) {
  const parsed = path.parse(candidate);
  const relative = path.relative(parsed.root, path.resolve(candidate));
  const ancestors = [parsed.root];
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    ancestors.push(current);
  }
  return ancestors;
}

async function lstatIfPresent(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}

function unsafeDestination() {
  return new Error("Review publication fragment destination is unsafe");
}
