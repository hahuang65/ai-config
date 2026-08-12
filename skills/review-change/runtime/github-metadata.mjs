import { parseGitHubTarget } from "./github-target.mjs";

const OUTPUT_LIMIT = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const REPOSITORY_BY_ID_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on Repository { id nameWithOwner }
  }
}`;
const BRANCHES_BY_ID_QUERY = `query($id: ID!, $qualifiedName: String!) {
  node(id: $id) {
    ... on Repository {
      id
      nameWithOwner
      defaultBranchRef { name target { ... on Commit { oid } } }
      selectedRef: ref(qualifiedName: $qualifiedName) { name target { ... on Commit { oid } } }
    }
  }
}`;

export async function resolveGitHubRepositoryMetadata({
  requestedIdentity,
  cwd,
  context,
  executeProviderFile,
}) {
  const repositoryLabel = requestedIdentity ?? "the acquired repository";
  context.onActivity("provider", `Resolve ${repositoryLabel} immutable provider identity`);
  const args = ["repo", "view", ...(requestedIdentity ? [requestedIdentity] : []), "--json", "id,nameWithOwner"];
  const { stdout } = await executeProviderFile("gh", args, {
    ...providerOptions(context.signal),
    ...(cwd ? { cwd } : {}),
  });
  return parseRepositoryMetadata(stdout);
}

export async function resolveGitHubRepositoryById({
  repositoryId,
  branchPath,
  exactBranch = false,
  context,
  executeProviderFile,
}) {
  if (!branchPath) {
    const metadata = await requestRepositoryNode({
      repositoryId, query: REPOSITORY_BY_ID_QUERY, context, executeProviderFile,
    });
    return parseRepositoryNode(metadata, repositoryId);
  }
  for (const branchName of branchCandidates(branchPath, exactBranch)) {
    const metadata = await requestRepositoryNode({
      repositoryId,
      query: BRANCHES_BY_ID_QUERY,
      qualifiedName: `refs/heads/${branchName}`,
      context,
      executeProviderFile,
    });
    const repository = parseRepositoryNode(metadata, repositoryId, branchName);
    if (repository.selectedBranch) return repository;
  }
  throw new Error(`GitHub branch target not found in the immutable provider repository: ${branchPath}`);
}

async function requestRepositoryNode({
  repositoryId, query, qualifiedName, context, executeProviderFile,
}) {
  context.onActivity("provider", `Resolve immutable provider repository ${repositoryId}`);
  const args = ["api", "graphql", "--field", `query=${query}`, "--field", `id=${repositoryId}`];
  if (qualifiedName) args.push("--field", `qualifiedName=${qualifiedName}`);
  const { stdout } = await executeProviderFile("gh", args, providerOptions(context.signal));
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("GitHub returned malformed immutable repository metadata");
  }
}

function parseRepositoryNode(response, expectedRepositoryId, selectedBranchName) {
  const node = response?.data?.node;
  if (response?.errors || !isRepositoryId(node?.id) || node.id !== expectedRepositoryId) {
    throw new Error("GitHub returned malformed immutable repository metadata");
  }
  const identity = parseRepositoryIdentity(node.nameWithOwner, "immutable repository");
  if (!selectedBranchName) return { id: node.id, ...identity };
  const defaultBranch = parseProviderBranch(node.defaultBranchRef, "default");
  const selectedBranch = node.selectedRef === null
    ? null
    : parseProviderBranch(node.selectedRef, "selected");
  if (selectedBranch && selectedBranch.name !== selectedBranchName) {
    throw new Error("GitHub returned malformed immutable repository metadata");
  }
  return { id: node.id, ...identity, defaultBranch, selectedBranch };
}

function parseProviderBranch(branch, label) {
  if (!isBranchName(branch?.name) || !isCommitOid(branch?.target?.oid)) {
    throw new Error(`GitHub returned malformed immutable repository ${label} branch metadata`);
  }
  return { name: branch.name, oid: branch.target.oid };
}

function branchCandidates(branchPath, exactBranch) {
  if (exactBranch) return [branchPath];
  const segments = branchPath.split("/");
  return segments.map((_segment, index) => segments.slice(0, segments.length - index).join("/"));
}

export function parseRepositoryMetadata(stdout) {
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw new Error("GitHub returned malformed repository metadata");
  }
  if (!isRepositoryId(metadata?.id)) throw new Error("GitHub returned malformed repository metadata");
  try {
    return { id: metadata.id, ...parseRepositoryIdentity(metadata.nameWithOwner, "repository") };
  } catch {
    throw new Error("GitHub returned malformed repository metadata");
  }
}

export function parsePullRequestMetadata(stdout) {
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw new Error("GitHub returned malformed pull-request metadata");
  }
  validateCommitOid(metadata.baseRefOid, "base");
  validateCommitOid(metadata.headRefOid, "head");
  const identity = parseGitHubTarget(`gh:${metadata.headRepository?.nameWithOwner}/pull/1`);
  return {
    baseRefOid: metadata.baseRefOid,
    headRefOid: metadata.headRefOid,
    headRepository: { owner: identity.owner, repository: identity.repository },
  };
}

function parseRepositoryIdentity(nameWithOwner, label) {
  try {
    const identity = parseGitHubTarget(`gh:${nameWithOwner}/pull/1`);
    return { owner: identity.owner, repository: identity.repository };
  } catch {
    throw new Error(`GitHub returned malformed ${label} metadata`);
  }
}

function providerOptions(signal) {
  return {
    encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: OUTPUT_LIMIT,
    signal,
    timeout: COMMAND_TIMEOUT_MS,
  };
}

function isRepositoryId(value) {
  return typeof value === "string"
    && value.length <= 256
    && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

function isBranchName(value) {
  if (typeof value !== "string" || !value || value.length > 1_024) return false;
  if (/^[./]|[/.]$|\.\.|@\{|[ ~^:?*[\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  return !value.split("/").some((segment) => !segment || segment.endsWith(".lock"));
}

function isCommitOid(value) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value ?? "");
}

function validateCommitOid(value, label) {
  if (!isCommitOid(value)) {
    throw new Error(`GitHub returned an invalid pull-request ${label} object ID`);
  }
}
