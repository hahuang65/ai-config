import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createLifecycleCancellation } from "./lifecycle-cancellation.mjs";
import { buildChangeReviewPrompt } from "./prompt.mjs";
import { createReportDirectory } from "./report-directory.mjs";
import { resolveReviewTarget } from "./target.mjs";
import { createTerminalStatus } from "./status.mjs";
import { createReviewWorkspace } from "./workspace.mjs";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDirectory = path.resolve(runtimeDirectory, "..");

export async function runChangeReview(options, dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  if (environment.CHANGE_REVIEW_GATE === "1") {
    throw Object.assign(new Error("a Change review gate is already active"), { code: "NESTED_GATE" });
  }
  const status = dependencies.status ?? createTerminalStatus();
  const cancellation = createLifecycleCancellation({ processRef: dependencies.processRef, status });
  const state = { workspace: null, exitCode: 1, failure: null };
  try {
    status.start({ target: options.target, intent: options.intent });
    state.exitCode = await executeReviewLifecycle({ options, dependencies, environment, status, cancellation, state });
  } catch (error) {
    if (cancellation.exitCode() === null) state.failure = error;
  }
  try {
    await cleanupReviewWorkspace(state.workspace, status);
  } catch (error) {
    state.failure ??= error;
    state.exitCode = 1;
  }
  const interruptedExitCode = cancellation.exitCode();
  if (interruptedExitCode !== null) state.exitCode = interruptedExitCode;
  try {
    await status.finish(state.exitCode);
  } finally {
    cancellation.cleanup();
  }
  if (state.failure && interruptedExitCode === null) {
    state.failure.changeReviewSummaryPrinted = true;
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
    return exitCode;
  } catch (error) {
    if (error?.reportPath) {
      status.setReportPath?.(error.reportPath);
      status.activity?.("report", "error", `Report retained at ${error.reportPath}`);
    }
    status.fail("report", error);
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

async function cleanupReviewWorkspace(workspace, status) {
  if (!workspace) return;
  await runStatusStage(
    status, "cleanup", "Cleanup", () => workspace.cleanup(),
    () => "Removed",
  );
}

async function runReviewStage(status, options, workspace, skillDirectory, environment, dependencies, cancellation) {
  const supportsPipeline = typeof status.processStarted === "function";
  if (supportsPipeline) status.processStarted();
  else status.begin("review", "Run Change review");
  try {
    const exitCode = await runInWorkspace(
      options, workspace, skillDirectory, environment, dependencies, status, cancellation,
    );
    if (supportsPipeline) return status.processExit(exitCode);
    if (exitCode === 0) status.succeed("review", "validation complete");
    else status.fail("review", `pi exited with status ${exitCode}`);
    return exitCode;
  } catch (error) {
    status.fail("review", error);
    throw error;
  }
}

async function runStatusStage(status, stage, label, operation, detail = () => "") {
  status.begin(stage, label);
  try {
    const value = await operation();
    status.succeed(stage, detail(value));
    return value;
  } catch (error) {
    status.fail(stage, error);
    throw error;
  }
}

function scopeLabel(scopeKind) {
  return scopeKind.replaceAll("-", " ");
}

async function runInWorkspace(options, workspace, skillDirectory, environment, dependencies, status, cancellation) {
  const reportRoot = workspace.reportRoot;
  const prompt = buildChangeReviewPrompt({ ...options, skillDirectory });
  const args = [...options.piOptions, "--mode", "json", "--print", "--no-session", "--skill", skillDirectory, prompt];
  const subagentModel = selectedSubagentModel(options.piOptions);
  const gateEnvironment = {
    ...environment,
    TMPDIR: reportRoot,
    CHANGE_REVIEW_GATE: "1",
    CHANGE_REVIEW_GATE_ROOT: workspace.cwd,
    CHANGE_REVIEW_REPORT_ROOT: reportRoot,
    ...(subagentModel ? { CHANGE_REVIEW_SUBAGENT_MODEL: subagentModel } : {}),
  };
  const spawnProcess = dependencies.spawnProcess ?? ((command, processArgs, processOptions) => (
    spawnInForeground(command, processArgs, processOptions, { status, cancellation })
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

export function spawnInForeground(command, args, options, dependencies = {}) {
  const processRef = dependencies.processRef ?? process;
  const spawnChild = dependencies.spawnChild ?? spawn;
  const status = dependencies.status;
  const cancellation = dependencies.cancellation;
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, options);
    const stdoutDecoder = createLineDecoder(parsePiEvent(status));
    const stderrDecoder = createLineDecoder((line) => status?.childError?.(line));
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", stdoutDecoder.write);
    child.stderr?.on?.("data", stderrDecoder.write);
    let interruptedSignal = null;
    const interrupt = (signal) => { interruptedSignal = signal; child.kill(signal); };
    if (cancellation) cancellation.attachChild(interrupt);
    else status?.setAbortHandler?.(interrupt);
    const onSigint = () => interrupt("SIGINT");
    const onSigterm = () => interrupt("SIGTERM");
    const cleanup = () => {
      if (cancellation) cancellation.detachChild();
      else {
        processRef.removeListener("SIGINT", onSigint);
        processRef.removeListener("SIGTERM", onSigterm);
        status?.setAbortHandler?.(null);
      }
    };
    if (!cancellation) {
      processRef.once("SIGINT", onSigint);
      processRef.once("SIGTERM", onSigterm);
    }
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code, signal) => {
      stdoutDecoder.end();
      stderrDecoder.end();
      cleanup();
      resolve(code ?? signalExitCode(interruptedSignal ?? signal));
    });
  });
}

function parsePiEvent(status) {
  return (line) => {
    if (!line) return;
    try {
      status?.piEvent?.(JSON.parse(line));
    } catch {
      status?.childError?.("Ignored malformed pi event");
    }
  };
}

function createLineDecoder(onLine) {
  const maximumBuffer = 2 * 1024 * 1024;
  let buffer = "";
  return {
    write(chunk) {
      buffer += String(chunk);
      if (buffer.length > maximumBuffer) {
        buffer = "";
        onLine("Ignored oversized pi event");
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line.replace(/\r$/, ""));
    },
    end() {
      if (buffer) onLine(buffer.replace(/\r$/, ""));
      buffer = "";
    },
  };
}

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
  const processOptions = dependencies.signal
    ? { stdio: "ignore", signal: dependencies.signal }
    : { stdio: "ignore" };
  try {
    await new Promise((resolve, reject) => {
      const child = spawnProcess(command, args, processOptions);
      child.once("error", reject);
      if (waitForExit) {
        child.once("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
        });
      } else {
        child.once("spawn", () => {
          child.unref?.();
          resolve();
        });
      }
    });
    return reportPath;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.reportPath = reportPath;
    throw failure;
  }
}

function viewerCommand(platform, reportPath) {
  if (platform === "darwin") {
    const reportUrl = pathToFileURL(reportPath).href;
    return {
      command: "osascript",
      args: [
        "-e",
        'tell application "Firefox"',
        "-e",
        "activate",
        "-e",
        `open location "${reportUrl}"`,
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

function signalExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}
