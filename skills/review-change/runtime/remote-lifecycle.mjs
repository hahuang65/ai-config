import { resolveAcquiredGitHubTarget } from "./target.mjs";
import { classifyRemoteTrust } from "./workspace.mjs";

export async function prepareDirectRemoteReview({
  githubTarget,
  explicitTrust,
  sandboxVerified,
  workspace,
  dependencies,
  status,
  signal,
}) {
  const resolveAcquiredTarget = dependencies.resolveAcquiredTarget ?? resolveAcquiredGitHubTarget;
  const classifyTrust = dependencies.classifyTrust ?? defaultClassifyTrust;
  const resolvedScope = await resolveAcquiredTarget({
    cwd: workspace.cwd,
    githubTarget,
    branchContentBinding: workspace.details?.branchContentBinding,
    signal,
    onActivity: (kind, message) => status.activity?.("workspace", kind, message),
  });
  assertContentBoundBranchScope(resolvedScope, workspace.details?.branchContentBinding);
  const trustClassification = await classifyTrust({
    explicitTrust,
    sandboxVerified,
    repositoryRoot: workspace.sourceRoot,
    headRepository: resolvedScope.headRepository,
    signal,
    onActivity: (kind, message) => status.activity?.("workspace", kind, message),
  });
  const reviewWorkspace = trustClassification.trusted
    ? await workspace.materializeHead(resolvedScope.selectedHeadOid)
    : workspace;
  reviewWorkspace.details = { ...reviewWorkspace.details, trustClassification };
  return {
    workspace: reviewWorkspace,
    scope: { ...resolvedScope, trustClassification },
  };
}

function assertContentBoundBranchScope(resolvedScope, binding) {
  if (resolvedScope.kind !== "remote-branch") return;
  const canonicalRepository = binding?.canonicalRepository;
  const scopeRepository = resolvedScope.headRepository;
  const scopeHead = resolvedScope.immutableRange?.split("...")[1];
  const matchesVerifiedContent = binding?.providerRepositoryId
    && resolvedScope.providerRepositoryId === binding.providerRepositoryId
    && resolvedScope.selectedHeadOid === binding.selectedBranch?.oid
    && scopeHead === binding.selectedBranch?.oid
    && scopeRepository?.owner === canonicalRepository?.owner
    && scopeRepository?.repository === canonicalRepository?.repository;
  if (!matchesVerifiedContent) {
    throw new Error("The resolved branch scope is not derived from verified provider and clone content");
  }
}

function defaultClassifyTrust(options) {
  if (options.explicitTrust) return { trusted: true, reason: "explicit" };
  if (options.sandboxVerified) return { trusted: true, reason: "sandbox" };
  return classifyRemoteTrust(options);
}
