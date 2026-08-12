import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTargetArgument } from "./arguments.mjs";
import { spawnInForeground } from "./foreground-process.mjs";
import { createLifecycleCancellation } from "./lifecycle-cancellation.mjs";
import { isGitHubTargetInput, parseGitHubTarget } from "./github-target.mjs";
import { buildReviewChangePrompt } from "./prompt.mjs";
import { createReportDirectory } from "./report-directory.mjs";
import { openReportArtifact } from "./report-viewer.mjs";
import { prepareDirectRemoteReview } from "./remote-lifecycle.mjs";
import { verifyDocumentedSandbox } from "./sandbox.mjs";
import { resolveReviewTarget } from "./target.mjs";
import { createTerminalStatus } from "./status.mjs";
import { createReviewWorkspace } from "./workspace.mjs";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDirectory = path.resolve(runtimeDirectory, "..");

export async function runReviewChange(options, dependencies = {}) {
  if (options.target !== null && options.target !== undefined) validateTargetArgument(options.target);
  const environment = dependencies.environment ?? process.env;
  if (environment.REVIEW_CHANGE_GATE === "1") {
    throw Object.assign(new Error("a Review change gate is already active"), { code: "NESTED_GATE" });
  }
  const sourceDirectory = dependencies.cwd ?? process.cwd();
  const githubTarget = explicitGitHubTarget(options.target);
  if (options.trustRemote && !githubTarget) {
    throw Object.assign(new Error("--trust-remote requires an explicit GitHub target"), { code: "USAGE_ERROR" });
  }
  if (options.sandbox && !githubTarget) {
    throw Object.assign(new Error("--sandbox requires an explicit GitHub target"), { code: "USAGE_ERROR" });
  }
  const verifySandbox = dependencies.verifySandbox ?? verifyDocumentedSandbox;
  const sandboxVerified = options.sandbox
    ? await verifySandbox({ environment })
    : false;
  if (options.sandbox && !sandboxVerified) {
    throw Object.assign(
      new Error("--sandbox requires the documented sandbox environment"),
      { code: "USAGE_ERROR" },
    );
  }
  const lifecycleOptions = sandboxVerified ? { ...options, sandboxVerified: true } : options;
  const isRepository = dependencies.isGitRepository ?? isGitRepository;
  const repositoryCheck = githubTarget ? true : isRepository(sourceDirectory);
  const insideRepository = repositoryCheck instanceof Promise ? await repositoryCheck : repositoryCheck;
  if (!githubTarget && !insideRepository) throw outsideRepositoryUsageError();
  const status = dependencies.status ?? createTerminalStatus();
  const cancellation = createLifecycleCancellation({ processRef: dependencies.processRef, status });
  const state = {
    workspace: null,
    exitCode: 1,
    failure: null,
    summaryPrinted: false,
    failureAfterSummary: false,
  };
  try {
    status.start({ target: options.target, intent: options.intent });
    state.exitCode = await executeReviewLifecycle({
      options: lifecycleOptions, dependencies, environment, status, cancellation, state,
    });
  } catch (error) {
    if (cancellation.exitCode() === null) state.failure = error;
  }
  const interruptedBeforeSummary = cancellation.exitCode();
  if (interruptedBeforeSummary !== null) state.exitCode = interruptedBeforeSummary;
  try {
    try {
      await status.finish(state.exitCode);
      state.summaryPrinted = true;
    } catch (error) {
      state.failure ??= error;
      state.exitCode = 1;
    }
    if (state.workspace) {
      const cleanupFailed = await captureCleanupFailure(state, status);
      state.failureAfterSummary = state.summaryPrinted && cleanupFailed;
    }
  } finally {
    cancellation.cleanup();
  }
  const interruptedExitCode = cancellation.exitCode();
  if (interruptedExitCode !== null) state.exitCode = interruptedExitCode;
  if (state.failure && interruptedExitCode === null) {
    state.failure.reviewChangeSummaryPrinted = state.summaryPrinted && !state.failureAfterSummary;
    throw state.failure;
  }
  return state.exitCode;
}

async function executeReviewLifecycle({ options, dependencies, environment, status, cancellation, state }) {
  const skillDirectory = path.resolve(dependencies.skillDirectory ?? defaultSkillDirectory);
  const sourceDirectory = dependencies.cwd ?? process.cwd();
  const requestedGitHubTarget = explicitGitHubTarget(options.target);
  const resolveTarget = dependencies.resolveTarget ?? resolveReviewTarget;
  let resolvedScope = await runStatusStage(status, "target", "Resolve target", () => resolveTarget({
    cwd: sourceDirectory,
    target: options.target,
    deferBranchFreshness: true,
    signal: cancellation.signal,
    onActivity: (kind, message) => status.activity?.("target", kind, message),
  }), (scope) => scope.kind === "local-branch"
    ? "local branch accepted for isolated fetch"
    : `${scopeLabel(scope.kind)} scope frozen`);
  cancellation.throwIfAborted();
  const acquiredGitHubTarget = directGitHubTarget(requestedGitHubTarget, resolvedScope);
  const materializeLocalDescendant = resolvedScope.kind === "local-branch";
  await createIsolatedWorkspace({
    sourceDirectory,
    githubTarget: acquiredGitHubTarget,
    fetchRemote: requiresLocalBranchFreshness(resolvedScope.kind, options.target),
    freshnessRemote: resolvedScope.freshnessRemote,
    dependencies,
    status,
    cancellation,
    state,
  });
  cancellation.throwIfAborted();
  if (acquiredGitHubTarget) {
    const remoteReview = await prepareDirectRemoteReview({
      githubTarget: acquiredGitHubTarget,
      explicitTrust: options.trustRemote === true,
      sandboxVerified: options.sandbox === true && options.sandboxVerified === true,
      workspace: state.workspace,
      dependencies,
      status,
      signal: cancellation.signal,
    });
    state.workspace = remoteReview.workspace;
    status.setWorkspacePath?.(state.workspace.cwd);
    resolvedScope = remoteReview.scope;
  } else if (requiresPostIsolationResolution(resolvedScope.kind, options.target)) {
    resolvedScope = await resolveTarget({
      cwd: state.workspace.cwd,
      target: options.target,
      freshnessRemote: resolvedScope.freshnessRemote,
      materializeSelectedHead: materializeLocalDescendant,
      signal: cancellation.signal,
      onActivity: (kind, message) => status.activity?.("workspace", kind, message),
    });
    if (materializeLocalDescendant) {
      if (!resolvedScope.selectedHeadOid || typeof state.workspace.materializeHead !== "function") {
        throw new Error("The selected local descendant cannot be materialized safely");
      }
      state.workspace = await state.workspace.materializeHead(resolvedScope.selectedHeadOid);
      status.setWorkspacePath?.(state.workspace.cwd);
    }
  }
  status.setScope?.(`${scopeLabel(resolvedScope.kind)} · ${resolvedScope.immutableRange ?? resolvedScope.target ?? "ask-user"}`);
  const resolvedOptions = {
    ...options,
    target: resolvedScope.target,
    scopeKind: resolvedScope.kind,
    sourceScopeResolved: true,
    immutableRange: resolvedScope.immutableRange,
    selectedHeadOid: resolvedScope.selectedHeadOid,
    headRepository: resolvedScope.headRepository,
    trustClassification: resolvedScope.trustClassification,
    materializationState: state.workspace.details?.materializationState,
  };
  const exitCode = await runReviewStage(
    status, resolvedOptions, state.workspace, skillDirectory, environment, dependencies, cancellation,
  );
  if (exitCode !== 0) return exitCode;
  cancellation.throwIfAborted();
  const openReport = dependencies.openReport ?? openReportArtifact;
  try {
    const reportPath = await openReport(state.workspace.reportRoot, { signal: cancellation.signal });
    status.setReportPath?.(reportPath);
    status.activity?.("report", "open", `Opened report at ${reportPath}`);
    status.throwIfFailed?.();
    return exitCode;
  } catch (error) {
    if (error?.reportPath) {
      status.setReportPath?.(error.reportPath);
      status.activity?.("report", "error", `Report retained at ${error.reportPath}`);
    }
    status.fail("report", error);
    status.throwIfFailed?.();
    throw error;
  }
}

async function createIsolatedWorkspace({
  sourceDirectory, githubTarget, fetchRemote, freshnessRemote, dependencies, status, cancellation, state,
}) {
  const createWorkspace = dependencies.createWorkspace ?? createReviewWorkspace;
  const createReportRoot = dependencies.createReportDirectory ?? createReportDirectory;
  await runStatusStage(status, "workspace", "Create isolation", async () => {
    state.workspace = await createWorkspace({
      cwd: sourceDirectory,
      githubTarget,
      fetchRemote,
      freshnessRemote,
      signal: cancellation.signal,
      onActivity: (kind, message) => status.activity?.("workspace", kind, message),
    });
    status.setWorkspacePath?.(state.workspace.cwd);
    status.attachTelemetryLog?.(state.workspace.cwd);
    status.activity?.("workspace", "path", "Validate a dedicated report root outside both checkouts");
    state.workspace.reportRoot = await createReportRoot({
      sourceRoot: state.workspace.sourceRoot,
      workspaceRoot: state.workspace.cwd,
      preferredRoot: dependencies.tempRoot ?? tmpdir(),
      fallbackRoot: dependencies.fallbackTempRoot,
    });
    status.activity?.("workspace", "report", `Report root ready at ${state.workspace.reportRoot}`);
    return state.workspace;
  }, () => "Snapshot ready · push disabled");
}

async function captureCleanupFailure(state, status) {
  try {
    await cleanupReviewWorkspace(state.workspace, status);
    return false;
  } catch (error) {
    state.failure = combineFailures(state.failure, error, "review lifecycle and cleanup failed");
    state.exitCode = 1;
    return true;
  }
}

async function cleanupReviewWorkspace(workspace, status) {
  if (!workspace) return;
  const failures = [];
  try {
    status.detachTelemetryLog?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    await workspace.cleanup();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 0) {
    status.succeed("cleanup", "Removed");
    return;
  }
  const failure = failures.length === 1
    ? failures[0]
    : new AggregateError(failures, "telemetry close and workspace cleanup failed");
  status.fail("cleanup", failure);
  throw failure;
}

function combineFailures(primary, secondary, message) {
  if (!primary) return secondary;
  return new AggregateError([primary, secondary], message);
}

async function runReviewStage(status, options, workspace, skillDirectory, environment, dependencies, cancellation) {
  const supportsPipeline = typeof status.processStarted === "function";
  if (supportsPipeline) status.processStarted();
  else status.begin("review", "Run Review change");
  status.throwIfFailed?.();
  try {
    const exitCode = await runInWorkspace(
      options, workspace, skillDirectory, environment, dependencies, status, cancellation,
    );
    const outcome = supportsPipeline ? status.processExit(exitCode) : exitCode;
    if (!supportsPipeline && exitCode === 0) status.succeed("review", "validation complete");
    if (!supportsPipeline && exitCode !== 0) status.fail("review", `pi exited with status ${exitCode}`);
    status.throwIfFailed?.();
    return outcome;
  } catch (error) {
    status.fail("review", error);
    status.throwIfFailed?.();
    throw error;
  }
}

async function runStatusStage(status, stage, label, operation, detail = () => "") {
  status.begin(stage, label);
  status.throwIfFailed?.();
  try {
    const value = await operation();
    status.succeed(stage, detail(value));
    status.throwIfFailed?.();
    return value;
  } catch (error) {
    status.fail(stage, error);
    status.throwIfFailed?.();
    throw error;
  }
}

function isGitRepository(cwd) {
  const check = spawnSync("git", ["-C", cwd, "rev-parse", "--git-dir"], {
    stdio: "ignore",
    timeout: 15_000,
  });
  return check.status === 0;
}

function outsideRepositoryUsageError() {
  const message = "Outside a Git repository, use an explicit GitHub target: "
    + "https://github.com/owner/repository/pull/59/changes, "
    + "gh:owner/repository/pull/59, "
    + "https://github.com/owner/repository/tree/feature/branch, or "
    + "gh:owner/repository/tree/feature/branch.";
  return Object.assign(new Error(message), { code: "USAGE_ERROR" });
}

function explicitGitHubTarget(target) {
  if (!isGitHubTargetInput(target)) return null;
  try {
    const parsedTarget = parseGitHubTarget(target);
    return parsedTarget.kind === "branch" && target.startsWith("gh:")
      ? { ...parsedTarget, exactBranch: true }
      : parsedTarget;
  } catch (error) {
    error.code = "USAGE_ERROR";
    throw error;
  }
}

function directGitHubTarget(requestedGitHubTarget, resolvedScope) {
  if (requestedGitHubTarget) return requestedGitHubTarget;
  if (resolvedScope.kind !== "pull-request") return null;
  const target = parseGitHubTarget(resolvedScope.target);
  if (target.kind !== "pull-request") throw new Error("Resolved pull-request scope is malformed");
  return target;
}

function requiresLocalBranchFreshness(scopeKind, target) {
  if (scopeKind === "local-branch") return true;
  return Boolean(target && scopeKind === "local-range" && !target.includes(".."));
}

function requiresPostIsolationResolution(scopeKind, target) {
  return scopeKind === "github-branch" || requiresLocalBranchFreshness(scopeKind, target);
}

function scopeLabel(scopeKind) {
  return scopeKind.replaceAll("-", " ");
}

async function runInWorkspace(options, workspace, skillDirectory, environment, dependencies, status, cancellation) {
  const reportRoot = workspace.reportRoot;
  const prompt = buildReviewChangePrompt({
    ...options,
    sourceRoot: workspace.sourceRoot,
    reviewRoot: workspace.cwd,
    requestedRepositorySshUrl: workspace.details?.requestedRepositorySshUrl,
    materializationState: workspace.details?.materializationState,
    skillDirectory,
  });
  const args = [...options.piOptions, "--mode", "json", "--print", "--no-session", "--skill", skillDirectory, prompt];
  const subagentModel = selectedSubagentModel(options.piOptions);
  const gateEnvironment = {
    ...environment,
    TMPDIR: reportRoot,
    REVIEW_CHANGE_GATE: "1",
    REVIEW_CHANGE_GATE_ROOT: workspace.cwd,
    REVIEW_CHANGE_REPORT_ROOT: reportRoot,
    ...(subagentModel ? { REVIEW_CHANGE_SUBAGENT_MODEL: subagentModel } : {}),
  };
  const spawnProcess = dependencies.spawnProcess ?? ((command, args, options) => (
    spawnInForeground(command, args, options, {
      status,
      cancellation,
      spawnChild: dependencies.spawnChild,
      setTimeoutFn: dependencies.setTimeoutFn,
      clearTimeoutFn: dependencies.clearTimeoutFn,
    })
  ));
  return spawnProcess("pi", args, { cwd: workspace.cwd, stdio: ["ignore", "pipe", "pipe"], env: gateEnvironment });
}

function selectedSubagentModel(piOptions) {
  const model = optionValue(piOptions, "--model");
  const provider = optionValue(piOptions, "--provider");
  if (!model || model.includes("/") || !provider) return model;
  return `${provider}/${model}`;
}

function optionValue(options, name) {
  const index = options.indexOf(name);
  return index === -1 ? null : options[index + 1] ?? null;
}

export { openReportArtifact, spawnInForeground };
