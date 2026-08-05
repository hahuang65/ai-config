import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { spawnInForeground } from "./foreground-process.mjs";
import { createLifecycleCancellation } from "./lifecycle-cancellation.mjs";
import { buildReviewChangePrompt } from "./prompt.mjs";
import { createReportDirectory } from "./report-directory.mjs";
import { resolveReviewTarget } from "./target.mjs";
import { createTerminalStatus } from "./status.mjs";
import { createReviewWorkspace } from "./workspace.mjs";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDirectory = path.resolve(runtimeDirectory, "..");
const viewerErrorLimit = 4_096;

export async function runReviewChange(options, dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  if (environment.REVIEW_CHANGE_GATE === "1") {
    throw Object.assign(new Error("a Review change gate is already active"), { code: "NESTED_GATE" });
  }
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
    state.exitCode = await executeReviewLifecycle({ options, dependencies, environment, status, cancellation, state });
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
  const resolveTarget = dependencies.resolveTarget ?? resolveReviewTarget;
  const resolvedScope = await runStatusStage(status, "target", "Resolve target", () => resolveTarget({
    cwd: sourceDirectory,
    target: options.target,
    signal: cancellation.signal,
    onActivity: (kind, message) => status.activity?.("target", kind, message),
  }), (scope) => `${scopeLabel(scope.kind)} scope frozen`);
  cancellation.throwIfAborted();
  status.setScope?.(`${scopeLabel(resolvedScope.kind)} · ${resolvedScope.target ?? "ask-user"}`);
  const resolvedOptions = { ...options, target: resolvedScope.target, scopeKind: resolvedScope.kind, sourceScopeResolved: true };
  await createIsolatedWorkspace({ sourceDirectory, dependencies, status, cancellation, state });
  cancellation.throwIfAborted();
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

async function createIsolatedWorkspace({ sourceDirectory, dependencies, status, cancellation, state }) {
  const createWorkspace = dependencies.createWorkspace ?? createReviewWorkspace;
  const createReportRoot = dependencies.createReportDirectory ?? createReportDirectory;
  await runStatusStage(status, "workspace", "Create isolation", async () => {
    state.workspace = await createWorkspace({
      cwd: sourceDirectory,
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

function scopeLabel(scopeKind) {
  return scopeKind.replaceAll("-", " ");
}

async function runInWorkspace(options, workspace, skillDirectory, environment, dependencies, status, cancellation) {
  const reportRoot = workspace.reportRoot;
  const prompt = buildReviewChangePrompt({
    ...options,
    sourceRoot: workspace.sourceRoot,
    reviewRoot: workspace.cwd,
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

export { spawnInForeground };

export async function openReportArtifact(reportRoot, dependencies = {}) {
  const readDirectory = dependencies.readDirectory ?? readdir;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const platform = dependencies.platform ?? process.platform;
  const entries = await readDirectory(reportRoot, { withFileTypes: true });
  const reports = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".html")
    .map((entry) => path.join(reportRoot, entry.name));
  if (reports.length !== 1) {
    throw new Error(`expected one HTML report in ${reportRoot}, found ${reports.length}`);
  }
  const reportPath = reports[0];
  const { command, args, waitForExit } = viewerCommand(platform, reportPath);
  const stdio = waitForExit ? ["ignore", "ignore", "pipe"] : "ignore";
  const processOptions = dependencies.signal
    ? { stdio, signal: dependencies.signal }
    : { stdio };
  try {
    await waitForViewer({ command, args, processOptions, spawnProcess, waitForExit });
    return reportPath;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.reportPath = reportPath;
    throw failure;
  }
}

function waitForViewer({ command, args, processOptions, spawnProcess, waitForExit }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, processOptions);
    let stderr = "";
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, viewerErrorLimit);
    });
    child.once("error", reject);
    if (!waitForExit) {
      child.once("spawn", () => {
        child.unref?.();
        resolve();
      });
      return;
    }
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.replace(/\s+/g, " ").trim();
      const suffix = detail ? `: ${detail}` : "";
      reject(new Error(`${command} exited with status ${code ?? "unknown"}${suffix}`));
    });
  });
}

function viewerCommand(platform, reportPath) {
  if (platform === "darwin") {
    const reportUrl = pathToFileURL(reportPath).href;
    return {
      command: "osascript",
      args: [
        "-e",
        'set firefoxApp to application "Firefox"',
        "-e",
        "tell firefoxApp",
        "-e",
        "activate",
        "-e",
        `«event GURLGURL» "${reportUrl}"`,
        "-e",
        "end tell",
      ],
      waitForExit: true,
    };
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [reportPath], waitForExit: false };
  }
  return { command: "xdg-open", args: [reportPath], waitForExit: false };
}
