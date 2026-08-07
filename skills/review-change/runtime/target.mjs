import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const GITHUB_PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:\/)?$/i;
const noActivity = () => {};

export async function resolveReviewTarget({
  cwd,
  target,
  findPullRequest = currentPullRequest,
  signal,
  onActivity = noActivity,
}) {
  const context = { signal, onActivity };
  if (target && (GITHUB_PR_URL.test(target) || /^\d+$/.test(target))) {
    onActivity("scope", `Accepted pull-request target ${target}`);
    return { kind: "pull-request", target };
  }
  if (target) return { kind: "local-range", target: await freezeLocalTarget(cwd, target, context) };
  onActivity("scope", "Checking the current branch for a pull request");
  const pullRequest = await findPullRequest(cwd, context);
  if (pullRequest && GITHUB_PR_URL.test(pullRequest)) {
    onActivity("scope", `Resolved current pull request ${pullRequest}`);
    return { kind: "pull-request", target: pullRequest };
  }
  onActivity("scope", "Resolving the current branch point against a non-self upstream or default branch");
  return { kind: "working-state", target: await branchPointRange(cwd, context) };
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
  if (!reference) throw new Error(`Branch target not found: ${branchName}`);
  const head = await commitObject(cwd, reference, context);
  const candidates = await baseCandidates(cwd, branchName, `${reference}@{upstream}`, context);
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
  const candidates = [
    `refs/heads/${branchName}`,
    `refs/remotes/${branchName}`,
    `refs/remotes/origin/${branchName}`,
  ];
  for (const reference of new Set(candidates)) {
    if (await optionalCommitObject(cwd, reference, context)) return reference;
  }
  return null;
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
  const originHead = await optionalGitOutput(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], context);
  const candidates = [];
  if (upstream && remoteBranchName(upstream) !== currentBranch) candidates.push(upstream);
  if (originHead) candidates.push(originHead);
  candidates.push("main", "master");
  return [...new Set(candidates)];
}

function remoteBranchName(reference) {
  const slash = reference.indexOf("/");
  return slash === -1 ? reference : reference.slice(slash + 1);
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

async function gitOutput(cwd, args, context = {}) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await executeFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT,
    signal: context.signal,
    timeout: COMMAND_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function optionalGitOutput(cwd, args, context) {
  try {
    return await gitOutput(cwd, args, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}
