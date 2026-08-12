import { lstat, readFile, realpath } from "node:fs/promises";

export const REVIEW_SANDBOX_SIGNAL = "review-change-gondolin-v1";
export const REVIEW_SANDBOX_MARKER = "/run/review-change/sandbox-v1";
const MARKER_CONTENT = "review-change-gondolin-v1\n";
const WRITABLE_BY_NON_OWNER = 0o022;

export async function verifyDocumentedSandbox({ environment = process.env } = {}, dependencies = {}) {
  if (environment.REVIEW_CHANGE_SANDBOX !== REVIEW_SANDBOX_SIGNAL) return false;
  const markerPath = dependencies.markerPath ?? REVIEW_SANDBOX_MARKER;
  const inspect = dependencies.lstat ?? lstat;
  const resolve = dependencies.realpath ?? realpath;
  const read = dependencies.readFile ?? readFile;
  try {
    const [markerStat, resolvedPath, content] = await Promise.all([
      inspect(markerPath),
      resolve(markerPath),
      read(markerPath, "utf8"),
    ]);
    return markerStat.isFile()
      && markerStat.uid === 0
      && (markerStat.mode & WRITABLE_BY_NON_OWNER) === 0
      && resolvedPath === markerPath
      && content === MARKER_CONTENT;
  } catch {
    return false;
  }
}
