import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { acquireGitHubRepository } from "./github-acquisition.mjs";
import { canonicalGitHubSshUrl } from "./github-target.mjs";
import {
  captureLocalSnapshot,
  clearReplayedUntracked,
  replayLocalSnapshot,
} from "./local-materialization.mjs";
import { isPathWithin, resolveProspectivePath } from "./report-directory.mjs";
import { parseSafeGitOutputRecord } from "../../shared/runtime/git-output-record.mjs";

export { acquireGitHubRepository } from "./github-acquisition.mjs";
export { classifyRemoteTrust } from "./trust-classification.mjs";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const noActivity = () => {};

export async function createReviewWorkspace(
  { cwd, fetchRemote = false, freshnessRemote = "origin", githubTarget, reviewRoot, signal, onActivity = noActivity } = {},
  dependencies = {},
) {
  const context = { signal, onActivity };
  if (githubTarget) {
    return createRemoteReviewWorkspace({ githubTarget, reviewRoot, dependencies }, context);
  }
  const sourceRoot = await gitOutput(["-C", cwd ?? process.cwd(), "rev-parse", "--show-toplevel"], context);
  const sourceHead = await gitOutput(["-C", sourceRoot, "rev-parse", "HEAD"], context);
  const sourceBranch = await optionalGitOutput(["-C", sourceRoot, "symbolic-ref", "--short", "HEAD"], context);
  const root = reviewRoot ?? defaultReviewWorkspaceRoot();
  onActivity("path", `Validate review workspace root ${root} outside source checkout ${sourceRoot}`);
  const sourceRealPath = await realpath(sourceRoot);
  const prospectiveRoot = await resolveProspectivePath(path.resolve(root));
  if (!prospectiveRoot || isPathWithin(prospectiveRoot, sourceRealPath)) {
    throw new Error("The review workspace root must be outside the reviewed repository");
  }
  throwIfAborted(signal);
  await mkdir(root, { recursive: true });
  const prefix = `${safeName(path.basename(sourceRoot))}-review-change-cli-`;
  const workspace = await mkdtemp(path.join(await realpath(root), prefix));
  if (isPathWithin(await realpath(workspace), sourceRealPath)) {
    await rm(workspace, { recursive: true, force: true });
    throw new Error("The isolated clone resolved inside the reviewed repository");
  }
  try {
    const snapshot = await populateClone({
      sourceRoot, sourceHead, sourceBranch, workspace, fetchRemote, freshnessRemote,
    }, context);
    onActivity("snapshot", `Snapshot ready: ${snapshot.patchBytes} patch bytes and ${snapshot.untrackedCount} untracked paths`);
    let localMaterialized = false;
    const reviewWorkspace = {
      cwd: workspace,
      sourceRoot,
      details: {
        patchBytes: snapshot.patchBytes,
        untrackedCount: snapshot.untrackedCount,
        pushDisabled: true,
        sourceHeadOid: sourceHead,
        materializationState: "source-snapshot",
      },
      cleanup: () => rm(workspace, { recursive: true, force: true }),
      materializeHead: async (selectedHeadOid) => {
        if (localMaterialized) throw new Error("The selected local head is already materialized");
        validateCommitOid(selectedHeadOid);
        await materializeLocalHead({ workspace, selectedHeadOid, snapshot, context });
        localMaterialized = true;
        return {
          ...reviewWorkspace,
          details: {
            ...reviewWorkspace.details,
            selectedHeadOid,
            materializationState: "selected-head-replayed",
          },
        };
      },
    };
    return reviewWorkspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function createRemoteReviewWorkspace({ githubTarget, reviewRoot, dependencies }, context) {
  const root = reviewRoot ?? defaultReviewWorkspaceRoot();
  context.onActivity("path", `Prepare direct GitHub review workspace root ${root}`);
  throwIfAborted(context.signal);
  await mkdir(root, { recursive: true });
  const prefix = `${safeName(githubTarget.repository)}-review-change-cli-`;
  const workspace = await mkdtemp(path.join(await realpath(root), prefix));
  const acquire = dependencies.acquireGitHubRepository ?? acquireGitHubRepository;
  const materialize = dependencies.materializeGitHead ?? materializeGitHead;
  const removeMaterialized = dependencies.removeMaterializedGitHead ?? removeMaterializedGitHead;
  const makeMaterializedDirectory = dependencies.makeMaterializedDirectory ?? mkdtemp;
  const removeMaterializedDirectory = dependencies.removeMaterializedDirectory ?? rm;
  let materializedPath = null;
  let materialized = false;
  const cleanup = () => cleanupRemoteWorkspace({
    workspace,
    materializedPath,
    materialized,
    removeMaterialized,
    removeMaterializedDirectory,
    context,
  });
  try {
    const acquisition = await acquire({ ...githubTarget, workspace, signal: context.signal, onActivity: context.onActivity });
    context.onActivity("snapshot", `Acquired GitHub repository ${githubTarget.owner}/${githubTarget.repository}`);
    const reviewWorkspace = {
      cwd: workspace,
      sourceRoot: workspace,
      details: {
        patchBytes: 0,
        untrackedCount: 0,
        remote: true,
        requestedRepositorySshUrl: canonicalGitHubSshUrl(githubTarget),
        ...acquisition,
      },
      cleanup,
      materializeHead: async (selectedHeadOid) => {
        if (materializedPath) throw new Error("The selected remote head is already materialized");
        validateCommitOid(selectedHeadOid);
        materializedPath = await allocateMaterializedPath(
          root,
          githubTarget.repository,
          (allocatedPath) => { materializedPath = allocatedPath; },
          { makeMaterializedDirectory, removeMaterializedDirectory },
        );
        await materialize({ repositoryRoot: workspace, materializedPath, selectedHeadOid, ...context });
        materialized = true;
        return {
          ...reviewWorkspace,
          cwd: materializedPath,
          details: { ...reviewWorkspace.details, materializedPath, selectedHeadOid },
        };
      },
    };
    return reviewWorkspace;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "direct acquisition and cleanup failed");
    }
    throw error;
  }
}

async function cleanupRemoteWorkspace({
  workspace, materializedPath, materialized, removeMaterialized, removeMaterializedDirectory, context,
}) {
  const failures = [];
  if (materializedPath) {
    try {
      if (materialized) {
        await removeMaterialized({ repositoryRoot: workspace, materializedPath, ...context, signal: undefined });
      } else {
        await removeMaterializedDirectory(materializedPath, { recursive: true, force: true });
      }
    } catch (error) {
      failures.push(new Error(`Failed to remove recorded materialized path ${materializedPath}: ${error.message}`, { cause: error }));
    }
  }
  try {
    await rm(workspace, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "direct workspace cleanup failed");
}

async function allocateMaterializedPath(reviewRoot, repository, recordAllocatedPath, dependencies) {
  const prefix = path.join(await realpath(reviewRoot), `${safeName(repository)}-selected-head-`);
  const allocatedPath = await dependencies.makeMaterializedDirectory(prefix);
  recordAllocatedPath(allocatedPath);
  await dependencies.removeMaterializedDirectory(allocatedPath, { recursive: true });
  return allocatedPath;
}

async function materializeLocalHead({ workspace, selectedHeadOid, snapshot, context }) {
  context.onActivity("snapshot", `Replay source snapshot onto exact selected head ${selectedHeadOid}`);
  try {
    await clearReplayedUntracked({ workspace, snapshot, signal: context.signal });
    await runGit(["-C", workspace, "reset", "--hard", "HEAD"], context);
    await runGit(["-C", workspace, "checkout", "--detach", selectedHeadOid], context);
    await replayLocalSnapshot({
      workspace,
      snapshot,
      applyTrackedPatch: (patch) => runGitWithInput(
        ["-C", workspace, "apply", "--binary", "-"], patch, context,
      ),
      signal: context.signal,
    });
    const materializedHead = await gitOutput(["-C", workspace, "rev-parse", "HEAD"], context);
    if (materializedHead !== selectedHeadOid) throw new Error("selected object ID verification failed");
  } catch (error) {
    throw new Error(
      `Could not replay the source working snapshot onto the selected local head: ${error.message}`,
      { cause: error },
    );
  }
}

async function materializeGitHead({ repositoryRoot, materializedPath, selectedHeadOid, signal, onActivity }) {
  onActivity("trust", `Materialize exact selected head ${selectedHeadOid}`);
  await runGit(["-C", repositoryRoot, "worktree", "add", "--detach", materializedPath, selectedHeadOid], {
    signal,
    onActivity,
  });
}

async function removeMaterializedGitHead({ repositoryRoot, materializedPath, signal, onActivity }) {
  onActivity("cleanup", `Remove recorded materialized path ${materializedPath}`);
  await runGit(["-C", repositoryRoot, "worktree", "remove", materializedPath], { signal, onActivity });
}

function validateCommitOid(selectedHeadOid) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(selectedHeadOid)) {
    throw new Error("The selected remote head must be an immutable commit object ID");
  }
}

async function populateClone({
  sourceRoot, sourceHead, sourceBranch, workspace, fetchRemote, freshnessRemote,
}, context) {
  await runGit(["clone", "--no-hardlinks", "--no-checkout", sourceRoot, workspace], context);
  await mirrorLocalBranches(sourceRoot, workspace, sourceBranch, context);
  await runGit(["-C", workspace, "checkout", sourceBranch || "--detach", ...(sourceBranch ? [] : [sourceHead])], context);
  const fetchUrl = await configureRemotes(sourceRoot, workspace, freshnessRemote, context);
  const snapshot = await captureLocalSnapshot({
    sourceRoot,
    workspace,
    readGitBuffer: (args) => gitBuffer(args, context),
    signal: context.signal,
  });
  await replayLocalSnapshot({
    workspace,
    snapshot,
    applyTrackedPatch: (patch) => runGitWithInput(["-C", workspace, "apply", "--binary", "-"], patch, context),
    signal: context.signal,
  });
  if (fetchRemote && !fetchUrl) {
    throw new Error(`Branch freshness requires a credential-safe ${freshnessRemote} fetch URL`);
  }
  if (fetchRemote) {
    await runGit(["-C", workspace, "fetch", freshnessRemote], context);
    await runGit(["-C", workspace, "remote", "set-head", freshnessRemote, "--auto"], context);
    context.onActivity("fetch", `Fetched current ${freshnessRemote} state and default branch inside review isolation`);
  }
  return {
    patchBytes: snapshot.trackedPatch.length,
    untrackedCount: snapshot.untrackedPaths.length,
    ...snapshot,
  };
}

async function mirrorLocalBranches(sourceRoot, workspace, checkedOutBranch, context) {
  const refs = await gitOutput([
    "-C", sourceRoot, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/",
  ], context);
  for (const line of refs.split("\n").filter(Boolean)) {
    throwIfAborted(context.signal);
    const [objectName, refName] = line.split(" ");
    if (refName === `refs/heads/${checkedOutBranch}`) continue;
    await runGit(["-C", workspace, "update-ref", refName, objectName], context);
  }
}

async function configureRemotes(sourceRoot, workspace, freshnessRemote, context) {
  const originFetchUrl = await configureRemote(sourceRoot, workspace, "origin", true, context);
  const freshnessFetchUrl = freshnessRemote === "origin"
    ? originFetchUrl
    : await configureRemote(sourceRoot, workspace, freshnessRemote, false, context);
  context.onActivity("guard", "Configured credential-safe fetch URLs and disabled the push URLs");
  return freshnessFetchUrl;
}

async function configureRemote(sourceRoot, workspace, remoteName, exists, context) {
  const remoteRecord = await optionalGitRawOutput(["-C", sourceRoot, "remote", "get-url", remoteName], context);
  const fetchUrl = safeRemoteUrlRecord(remoteRecord);
  const guardedUrl = fetchUrl || "no-fetch://review-change";
  const configureArguments = exists
    ? ["-C", workspace, "remote", "set-url", remoteName, guardedUrl]
    : ["-C", workspace, "remote", "add", remoteName, guardedUrl];
  await runGit(configureArguments, context);
  await runGit(["-C", workspace, "remote", "set-url", "--push", remoteName, "no-push://review-change"], context);
  return fetchUrl;
}

async function gitOutput(args, context = {}) {
  return (await gitRawOutput(args, context)).trim();
}

async function gitRawOutput(args, context = {}) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await executeFile("git", args, {
    encoding: "utf8", maxBuffer: OUTPUT_LIMIT, signal: context.signal, timeout: COMMAND_TIMEOUT_MS,
  });
  return stdout;
}

async function optionalGitOutput(args, context) {
  try {
    return await gitOutput(args, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}

async function optionalGitRawOutput(args, context) {
  try {
    return await gitRawOutput(args, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}

async function gitBuffer(args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await executeFile("git", args, {
    encoding: "buffer", maxBuffer: OUTPUT_LIMIT, signal: context.signal, timeout: COMMAND_TIMEOUT_MS,
  });
  return stdout;
}

async function runGit(args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  await executeFile("git", args, {
    maxBuffer: OUTPUT_LIMIT, signal: context.signal, timeout: COMMAND_TIMEOUT_MS,
  });
}

function runGitWithInput(args, input, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(COMMAND_TIMEOUT_MS);
    const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
    const child = spawn("git", args, { stdio: ["pipe", "ignore", "pipe"], signal });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `git exited ${code}`)));
    child.stdin.end(input);
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("workspace creation interrupted"), { name: "AbortError" });
}

export function defaultReviewWorkspaceRoot(homeDirectory = homedir()) {
  return path.join(homeDirectory, ".review-orchard");
}

export function safeRemoteUrlRecord(stdout) {
  const remoteUrl = parseSafeGitOutputRecord(stdout);
  return remoteUrl === null ? null : safeRemoteUrl(remoteUrl);
}

export function safeRemoteUrl(remoteUrl) {
  if (!remoteUrl || /[\u0000-\u001f\u007f-\u009f]/u.test(remoteUrl)) return null;
  if (/^(?:file|git|https?|ssh):\/\//i.test(remoteUrl)) {
    try {
      const parsed = new URL(remoteUrl);
      if (parsed.search || parsed.hash) return null;
      parsed.username = parsed.protocol === "ssh:" && parsed.username === "git" ? "git" : "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }
  if (/[?#]/.test(remoteUrl)) return null;
  if (/^(?:git@)?[^/@:\s]+:[^\s]+$/.test(remoteUrl)) return remoteUrl;
  return null;
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}
