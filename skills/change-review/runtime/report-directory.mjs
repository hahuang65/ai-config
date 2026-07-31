import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";

export async function createReportDirectory({
  sourceRoot,
  workspaceRoot,
  preferredRoot = tmpdir(),
  fallbackRoot = defaultFallbackRoot(),
}) {
  const protectedRoots = await Promise.all([realpath(sourceRoot), realpath(workspaceRoot)]);
  for (const candidate of [preferredRoot, fallbackRoot]) {
    const safeRoot = await prepareSafeRoot(candidate, protectedRoots);
    if (safeRoot) return mkdtemp(path.join(safeRoot, "change-review-report-"));
  }
  throw new Error("No safe temporary directory is available for the Change review report");
}

async function prepareSafeRoot(candidate, protectedRoots) {
  const absoluteCandidate = path.resolve(candidate);
  if (protectedRoots.some((root) => isPathWithin(absoluteCandidate, root))) return null;
  const prospectivePath = await resolveProspectivePath(absoluteCandidate);
  if (!prospectivePath || protectedRoots.some((root) => isPathWithin(prospectivePath, root))) return null;
  try {
    await mkdir(absoluteCandidate, { recursive: true });
    return await realpath(absoluteCandidate);
  } catch {
    return null;
  }
}

export async function resolveProspectivePath(candidate) {
  let existingAncestor = candidate;
  const missingSegments = [];
  while (true) {
    try {
      return path.join(await realpath(existingAncestor), ...missingSegments);
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) return null;
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

export function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultFallbackRoot() {
  return process.platform === "win32" ? path.join(homedir(), ".change-review-tmp") : "/tmp";
}
