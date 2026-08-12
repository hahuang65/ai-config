import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalGitHubSshUrl } from "./github-target.mjs";
import { isPathWithin } from "./report-directory.mjs";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const noActivity = () => {};

export async function classifyRemoteTrust(
  { repositoryRoot, headRepository, signal, onActivity = noActivity },
  dependencies = {},
) {
  const execute = dependencies.executeFile ?? executeFile;
  const makeTemporaryDirectory = dependencies.makeTemporaryDirectory ?? mkdtemp;
  const remove = dependencies.removeDirectory ?? rm;
  const resolveRealPath = dependencies.resolveRealPath ?? realpath;
  const repositorySshUrl = canonicalGitHubSshUrl(headRepository);
  const classificationContext = await makeTemporaryDirectory(
    path.join(dependencies.temporaryRoot ?? tmpdir(), "review-change-classification-"),
  );
  try {
    const canonicalContext = await resolveRealPath(classificationContext);
    onActivity("trust", `Classify actual head repository ${repositorySshUrl}`);
    const repositoryPath = await resolveRealPath(repositoryRoot);
    if (isPathWithin(canonicalContext, repositoryPath)) {
      throw new Error("The trust classification context must be outside the acquired repository");
    }
    const { stdout } = await execute("git", [
      `--git-dir=${path.join(canonicalContext, "classification.git")}`,
      "-c", `remote.review-change-classification.url=${repositorySshUrl}`,
      "config", "--show-scope", "--show-origin", "--get", "ai.projectFamily",
    ], {
      encoding: "utf8",
      maxBuffer: OUTPUT_LIMIT,
      signal,
      timeout: COMMAND_TIMEOUT_MS,
    });
    const [scope, , value] = stdout.trim().split("\t");
    const trusted = (scope === "global" || scope === "system") && value === "a5";
    return { trusted, reason: trusted ? "a5" : "untrusted" };
  } catch (error) {
    if (signal?.aborted || error?.code !== 1) throw error;
    return { trusted: false, reason: "untrusted" };
  } finally {
    await remove(classificationContext, { recursive: true, force: true });
  }
}
