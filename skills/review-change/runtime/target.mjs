import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  isCanonicalPullRequestNumber,
  isGitHubTargetInput,
  parseGitHubRepositoryUrl,
  parseGitHubTarget,
} from "./github-target.mjs";
import {
  freezeContentBoundGitHubBranchRange,
  hasVerifiedBranchContent,
} from "./github-branch-content.mjs";
import { parsePullRequestMetadata } from "./github-metadata.mjs";
import { parseSafeGitOutputRecord } from "../../shared/runtime/git-output-record.mjs";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const noActivity = () => {};

export async function resolveAcquiredGitHubTarget({
  cwd,
  githubTarget,
  signal,
  executeGitFile = executeFile,
  executeProviderFile = executeFile,
  branchContentBinding,
  onActivity = noActivity,
}) {
  const context = { signal, executeGitFile, onActivity };
  if (githubTarget.kind === "branch") {
    if (!hasVerifiedBranchContent(branchContentBinding)) {
      throw new Error("The acquired GitHub branch is missing verified provider and clone branch content");
    }
    const immutableRange = await freezeContentBoundGitHubBranchRange(cwd, branchContentBinding, context);
    return {
      kind: "remote-branch",
      target: immutableRange,
      immutableRange,
      selectedHeadOid: branchContentBinding.selectedBranch.oid,
      providerRepositoryId: branchContentBinding.providerRepositoryId,
      headRepository: branchContentBinding.canonicalRepository,
    };
  }
  return freezePullRequestTarget(cwd, githubTarget, context, executeProviderFile);
}

export async function resolveReviewTarget({
  cwd,
  target,
  findPullRequest = currentPullRequest,
  deferBranchFreshness = false,
  freshnessRemote,
  materializeSelectedHead = false,
  signal,
  executeGitFile = executeFile,
  onActivity = noActivity,
}) {
  const context = {
    signal, onActivity, deferBranchFreshness, freshnessRemote, materializeSelectedHead, executeGitFile,
  };
  if (isGitHubTargetInput(target)) {
    const githubTarget = parseGitHubTarget(target);
    if (githubTarget.kind === "pull-request") {
      const normalizedTarget = pullRequestUrl(githubTarget);
      onActivity("scope", `Accepted pull-request target ${normalizedTarget}`);
      return { kind: "pull-request", target: normalizedTarget };
    }
    const normalizedTarget = branchUrl(githubTarget);
    if (deferBranchFreshness) return { kind: "github-branch", target: normalizedTarget };
    const exactBranch = target.startsWith("gh:");
    return {
      kind: "remote-branch",
      target: await freezeGitHubBranchRange(cwd, githubTarget.branch, context, exactBranch),
    };
  }
  if (target && await hasExactLocalBranch(cwd, target, context)) {
    return resolveLocalTarget(cwd, target, context);
  }
  const pullRequestNumber = pullRequestShorthand(target);
  if (pullRequestNumber) {
    const repository = await selectedGitHubRepository(cwd, context);
    const normalizedTarget = `https://github.com/${repository.owner}/${repository.repository}/pull/${pullRequestNumber}`;
    onActivity("scope", `Accepted pull-request target ${normalizedTarget}`);
    return { kind: "pull-request", target: normalizedTarget };
  }
  if (target) return resolveLocalTarget(cwd, target, context);
  onActivity("scope", "Checking the current branch for a pull request");
  const pullRequest = await findPullRequest(cwd, context);
  if (isGitHubTargetInput(pullRequest)) {
    const normalizedTarget = pullRequestUrl(parseGitHubTarget(pullRequest));
    onActivity("scope", `Resolved current pull request ${normalizedTarget}`);
    return { kind: "pull-request", target: normalizedTarget };
  }
  onActivity("scope", "Resolving the current branch point against a non-self upstream or default branch");
  return { kind: "working-state", target: await branchPointRange(cwd, context) };
}

async function freezePullRequestTarget(cwd, githubTarget, context, executeProviderFile) {
  const { owner, repository, number } = githubTarget;
  context.onActivity("provider", `Resolve pull-request ${number} immutable metadata`);
  const { stdout } = await executeProviderFile("gh", [
    "pr", "view", String(number), "--repo", `${owner}/${repository}`,
    "--json", "baseRefOid,headRefOid,headRepository",
  ], {
    encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: OUTPUT_LIMIT,
    signal: context.signal,
    timeout: COMMAND_TIMEOUT_MS,
  });
  const metadata = parsePullRequestMetadata(stdout);
  await commitObject(cwd, metadata.baseRefOid, context);
  await ensurePullRequestHead(cwd, number, metadata.headRefOid, context);
  return {
    kind: "pull-request",
    target: `https://github.com/${owner}/${repository}/pull/${number}`,
    immutableRange: `${metadata.baseRefOid}...${metadata.headRefOid}`,
    selectedHeadOid: metadata.headRefOid,
    headRepository: metadata.headRepository,
  };
}

async function ensurePullRequestHead(cwd, number, expectedHeadOid, context) {
  const selectedRef = `refs/review-change/pull/${number}/head`;
  await gitOutput(cwd, ["fetch", "origin", `+refs/pull/${number}/head:${selectedRef}`], context);
  const fetchedHead = await commitObject(cwd, selectedRef, context);
  if (fetchedHead !== expectedHeadOid) throw new Error("Fetched pull-request head does not match provider metadata");
}

async function resolveLocalTarget(cwd, target, context) {
  if (context.deferBranchFreshness && !target.includes("..")) {
    await gitOutput(cwd, ["check-ref-format", "--branch", target], context);
    const reference = await branchReference(cwd, target, context);
    if (!reference && !target.startsWith("origin/")) throw new Error(`Branch target not found: ${target}`);
    const matchingRemote = await matchingFreshnessRemote(cwd, target, context);
    return matchingRemote === "origin"
      ? { kind: "local-branch", target }
      : { kind: "local-branch", target, freshnessRemote: matchingRemote };
  }
  const frozenTarget = await freezeLocalTarget(cwd, target, context);
  if (frozenTarget === null) return { kind: "local-branch", target };
  if (!context.materializeSelectedHead) return { kind: "local-range", target: frozenTarget };
  return {
    kind: "local-range",
    target: frozenTarget,
    immutableRange: frozenTarget,
    selectedHeadOid: frozenTarget.split("...")[1],
  };
}

function pullRequestShorthand(target) {
  const match = /^(?:pull\/)?(\d+)$/.exec(target ?? "");
  if (!match) return null;
  if (!isCanonicalPullRequestNumber(match[1])) {
    throw Object.assign(
      new Error("The pull-request number must be a canonical positive decimal from 1 through 2147483647"),
      { code: "USAGE_ERROR" },
    );
  }
  return match[1];
}

async function selectedGitHubRepository(cwd, context) {
  const names = (await gitOutput(cwd, ["remote"], context)).split("\n").filter(Boolean);
  const candidates = [];
  for (const name of names) {
    const url = await gitRemoteUrlRecord(cwd, name, context);
    const repository = parseGitHubRepositoryUrl(url);
    if (repository) candidates.push({ name, ...repository });
  }
  const origin = candidates.find(({ name }) => name === "origin");
  if (origin) return origin;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new Error("Pull-request shorthand requires a GitHub remote");
  throw new Error("Pull-request shorthand is ambiguous across multiple GitHub remotes");
}

async function hasExactLocalBranch(cwd, target, context) {
  return Boolean(await optionalCommitObject(cwd, `refs/heads/${target}`, context));
}

async function freezeLocalTarget(cwd, target, context) {
  const separator = target.includes("...") ? "..." : target.includes("..") ? ".." : null;
  if (separator) return freezeLocalRange(cwd, target, separator, context);
  return freezeBranchRange(cwd, target, context);
}

async function freezeLocalRange(cwd, range, separator, context) {
  const [base, head, ...extra] = range.split(separator);
  if (!base || !head || extra.length > 0) throw new Error("The local Git range is malformed");
  const baseObject = await commitObject(cwd, base, context);
  const headObject = await commitObject(cwd, head, context);
  context.onActivity("scope", `Frozen explicit range ${baseObject}${separator}${headObject}`);
  return `${baseObject}${separator}${headObject}`;
}

async function freezeBranchRange(cwd, branchName, context) {
  await gitOutput(cwd, ["check-ref-format", "--branch", branchName], context);
  const reference = await branchReference(cwd, branchName, context);
  if (!reference && context.deferBranchFreshness && branchName.startsWith("origin/")) return null;
  if (!reference) throw new Error(`Branch target not found: ${branchName}`);
  const head = await commitObject(cwd, reference, context);
  const candidates = await defaultBranchCandidates(cwd, context);
  for (const candidate of candidates) {
    const base = await optionalCommitObject(cwd, candidate, context);
    if (!base || base === head) continue;
    const branchPoint = await gitOutput(cwd, ["merge-base", base, head], context);
    context.onActivity("scope", `Frozen branch ${branchName} as ${branchPoint}...${head}`);
    return `${branchPoint}...${head}`;
  }
  throw new Error(`Could not resolve a base branch for: ${branchName}`);
}

async function branchReference(cwd, branchName, context) {
  const pairedBranch = pairedBranchName(branchName);
  const localReference = `refs/heads/${pairedBranch}`;
  const remoteName = branchName.startsWith("origin/") ? "origin" : context.freshnessRemote ?? "origin";
  const remoteReference = `refs/remotes/${remoteName}/${pairedBranch}`;
  const local = await optionalCommitObject(cwd, localReference, context);
  const remote = await optionalCommitObject(cwd, remoteReference, context);
  if (local && remote && context.deferBranchFreshness) return localReference;
  if (local && remote) return fresherReference(cwd, { localReference, local, remoteReference, remote }, context);
  if (local) return localReference;
  if (remote) return remoteReference;
  const explicitRemote = `refs/remotes/${branchName}`;
  return await optionalCommitObject(cwd, explicitRemote, context) ? explicitRemote : null;
}

function pairedBranchName(branchName) {
  return branchName.startsWith("origin/") ? branchName.slice("origin/".length) : branchName;
}

async function matchingFreshnessRemote(cwd, branchName, context) {
  if (branchName.startsWith("origin/")) return "origin";
  const pairedBranch = pairedBranchName(branchName);
  const remote = await optionalGitOutput(cwd, ["config", "--get", `branch.${pairedBranch}.remote`], context);
  const merge = await optionalGitOutput(cwd, ["config", "--get", `branch.${pairedBranch}.merge`], context);
  return remote && remote !== "." && merge === `refs/heads/${pairedBranch}` ? remote : "origin";
}

async function fresherReference(cwd, references, context) {
  const { localReference, local, remoteReference, remote } = references;
  if (local === remote) return localReference;
  if (await isAncestor(cwd, local, remote, context)) return remoteReference;
  if (await isAncestor(cwd, remote, local, context)) return localReference;
  throw new Error("Local and matching remote branch tips have diverged; choose a branch explicitly after reconciling them");
}

async function isAncestor(cwd, ancestor, descendant, context) {
  try {
    await gitOutput(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], context);
    return true;
  } catch (error) {
    if (context.signal?.aborted) throw error;
    if (error?.code === 1) return false;
    throw Object.assign(
      new Error(`Git ancestry check failed; repair the repository and retry: ${error.message}`, { cause: error }),
      { code: error?.code },
    );
  }
}

async function branchPointRange(cwd, context) {
  const head = await commitObject(cwd, "HEAD", context);
  const currentBranch = await optionalGitOutput(cwd, ["symbolic-ref", "--short", "HEAD"], context);
  const candidates = await baseCandidates(cwd, currentBranch, "@{upstream}", context);
  for (const candidate of candidates) {
    const base = await optionalCommitObject(cwd, candidate, context);
    if (!base) continue;
    const branchPoint = await gitOutput(cwd, ["merge-base", base, head], context);
    context.onActivity("scope", `Frozen working-state range ${branchPoint}...${head}`);
    return `${branchPoint}...${head}`;
  }
  return null;
}

async function baseCandidates(cwd, currentBranch, upstreamReference, context) {
  const upstream = await optionalGitOutput(cwd, ["rev-parse", "--abbrev-ref", upstreamReference], context);
  const candidates = [];
  if (upstream && remoteBranchName(upstream) !== currentBranch) candidates.push(upstream);
  candidates.push(...await defaultBranchCandidates(cwd, context));
  return [...new Set(candidates)];
}

async function defaultBranchCandidates(cwd, context) {
  const remoteName = context.freshnessRemote ?? "origin";
  const remoteHead = await optionalGitOutput(cwd, ["symbolic-ref", "--short", `refs/remotes/${remoteName}/HEAD`], context);
  return [...new Set([remoteHead, "main", "master"].filter(Boolean))];
}

function remoteBranchName(reference) {
  const slash = reference.indexOf("/");
  return slash === -1 ? reference : reference.slice(slash + 1);
}

function pullRequestUrl(target) {
  return `https://github.com/${target.owner}/${target.repository}/pull/${target.number}`;
}

function branchUrl(target) {
  return `https://github.com/${target.owner}/${target.repository}/tree/${target.branch}`;
}

async function freezeGitHubBranchRange(cwd, branchPath, context, exactBranch = false) {
  const headReference = exactBranch
    ? await exactBranchReference(cwd, branchPath, context)
    : await longestBranchReference(cwd, branchPath, context);
  if (!headReference) throw new Error(`GitHub branch target not found: ${branchPath}`);
  const defaultReference = await optionalGitOutput(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], context);
  if (!defaultReference) throw new Error("Could not resolve the GitHub repository default branch");
  const base = await commitObject(cwd, defaultReference, context);
  const head = await commitObject(cwd, headReference, context);
  const branchPoint = await gitOutput(cwd, ["merge-base", base, head], context);
  context.onActivity("scope", `Frozen GitHub branch ${branchPoint}...${head}`);
  return `${branchPoint}...${head}`;
}

async function exactBranchReference(cwd, branchPath, context) {
  for (const reference of [`refs/remotes/origin/${branchPath}`, `refs/heads/${branchPath}`]) {
    if (await optionalCommitObject(cwd, reference, context)) return reference;
  }
  return null;
}

async function longestBranchReference(cwd, branchPath, context) {
  const segments = branchPath.split("/");
  for (let length = segments.length; length > 0; length -= 1) {
    const branch = segments.slice(0, length).join("/");
    for (const reference of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
      if (await optionalCommitObject(cwd, reference, context)) return reference;
    }
  }
  return null;
}

async function currentPullRequest(cwd, context = {}) {
  context.onActivity?.("provider", "gh pr view --json url --jq .url");
  try {
    const { stdout } = await executeFile("gh", ["pr", "view", "--json", "url", "--jq", ".url"], {
      cwd,
      encoding: "utf8",
      maxBuffer: OUTPUT_LIMIT,
      signal: context.signal,
      timeout: COMMAND_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}

async function commitObject(cwd, reference, context) {
  return gitOutput(cwd, ["rev-parse", "--verify", `${reference}^{commit}`], context);
}

async function optionalCommitObject(cwd, reference, context) {
  try {
    return await commitObject(cwd, reference, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}

async function gitRemoteUrlRecord(cwd, remoteName, context) {
  const stdout = await gitRawOutput(cwd, ["remote", "get-url", remoteName], context);
  return parseSafeGitOutputRecord(stdout) ?? "";
}

async function gitOutput(cwd, args, context = {}) {
  return (await gitRawOutput(cwd, args, context)).trim();
}

async function gitRawOutput(cwd, args, context = {}) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await (context.executeGitFile ?? executeFile)("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT,
    signal: context.signal,
    timeout: COMMAND_TIMEOUT_MS,
  });
  return stdout;
}

async function optionalGitOutput(cwd, args, context) {
  try {
    return await gitOutput(cwd, args, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}
