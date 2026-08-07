import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

export const LANE_TIMEOUT_MS = 180_000;
export const CHILD_TERMINATION_GRACE_MS = 2_000;

const ISOLATED_GIT_ENV = Object.freeze({
  GIT_CONFIG_COUNT: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_PARAMETERS: "",
  GIT_CONFIG_SYSTEM: "/dev/null",
});
const activeChildren = new Set();
const terminationGracePeriods = new WeakMap();
const terminationTimers = new WeakMap();

export async function runLaneProcess(laneDefinition, suiteSignal) {
  suiteSignal?.throwIfAborted();
  if (laneDefinition.temporaryDirectory) {
    await mkdir(laneDefinition.temporaryDirectory, { recursive: true });
  }
  suiteSignal?.throwIfAborted();
  return spawnLaneProcess(laneDefinition, suiteSignal);
}

function spawnLaneProcess(laneDefinition, suiteSignal) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const child = spawn(laneDefinition.command, laneDefinition.args, {
      cwd: laneDefinition.cwd,
      detached: process.platform !== "win32",
      env: laneEnvironment(laneDefinition),
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);
    terminationGracePeriods.set(child, laneDefinition.terminationGraceMs ?? CHILD_TERMINATION_GRACE_MS);
    const output = { stdout: [], stderr: [] };
    const state = { timedOut: false };
    const timeout = startLaneTimeout(child, laneDefinition, output.stderr, state);
    const abort = () => terminateChild(child);
    suiteSignal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => output.stdout.push(chunk));
    child.stderr.on("data", (chunk) => output.stderr.push(chunk));
    child.on("error", (error) => output.stderr.push(Buffer.from(`${error.message}\n`)));
    child.on("close", (exitCode, signal) => void finishLane({
      abort, child, exitCode, laneDefinition, output, resolve, signal, startedAt, state, suiteSignal, timeout,
    }));
  });
}

function startLaneTimeout(child, laneDefinition, stderr, state) {
  const timeoutMs = laneDefinition.timeoutMs ?? LANE_TIMEOUT_MS;
  return setTimeout(() => {
    state.timedOut = true;
    stderr.push(Buffer.from(`Lane timed out after ${timeoutMs}ms\n`));
    terminateChild(child);
  }, timeoutMs);
}

async function finishLane(details) {
  const { child, laneDefinition, output, state } = details;
  clearTimeout(details.timeout);
  details.suiteSignal?.removeEventListener("abort", details.abort);
  const hadResidualGroup = process.platform !== "win32"
    && child.pid !== undefined
    && processGroupExists(child.pid);
  let groupStopped = true;
  if (hadResidualGroup) {
    output.stderr.push(Buffer.from(`Lane left process group ${child.pid} running\n`));
    groupStopped = await stopResidualProcessGroup(
      child.pid,
      terminationGracePeriods.get(child) ?? CHILD_TERMINATION_GRACE_MS,
      output.stderr,
    );
  }
  clearChildOwnership(child);
  details.resolve(Object.freeze({
    ...laneDefinition,
    durationSeconds: (performance.now() - details.startedAt) / 1_000,
    exitCode: state.timedOut || hadResidualGroup || !groupStopped ? 1 : details.exitCode ?? 1,
    signal: details.signal,
    stdout: Buffer.concat(output.stdout).toString("utf8"),
    stderr: Buffer.concat(output.stderr).toString("utf8"),
  }));
}

function laneEnvironment(laneDefinition) {
  const environment = laneDefinition.isolatedGit
    ? isolatedGitEnvironment(process.env)
    : { ...process.env, ...laneDefinition.env };
  if (laneDefinition.temporaryDirectory) environment.TMPDIR = laneDefinition.temporaryDirectory;
  return environment;
}

export function isolatedGitEnvironment(environment = process.env) {
  const isolated = Object.fromEntries(
    Object.entries(environment).filter(([variable]) => !variable.startsWith("GIT_")),
  );
  return { ...isolated, ...ISOLATED_GIT_ENV };
}

function terminateChild(child, signal = "SIGTERM") {
  if (child.pid === undefined) return;
  if (child.exitCode !== null && (process.platform === "win32" || !processGroupExists(child.pid))) return;
  signalChildProcess(child, signal);
  if (signal === "SIGKILL" || terminationTimers.has(child)) return;
  const grace = terminationGracePeriods.get(child) ?? CHILD_TERMINATION_GRACE_MS;
  const timer = setTimeout(() => signalChildProcess(child, "SIGKILL"), grace);
  timer.unref();
  terminationTimers.set(child, timer);
}

function signalChildProcess(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopResidualProcessGroup(processGroupId, grace, stderr) {
  if (!processGroupExists(processGroupId)) return true;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") stderr.push(Buffer.from(`${error.message}\n`));
  }
  const deadline = Date.now() + grace;
  while (processGroupExists(processGroupId) && Date.now() < deadline) await Bun.sleep(20);
  const stopped = !processGroupExists(processGroupId);
  if (!stopped) stderr.push(Buffer.from(`Process group ${processGroupId} did not stop\n`));
  return stopped;
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function clearChildOwnership(child) {
  const timer = terminationTimers.get(child);
  if (timer) clearTimeout(timer);
  terminationTimers.delete(child);
  terminationGracePeriods.delete(child);
  activeChildren.delete(child);
}

export function stopChildren(signal) {
  for (const child of activeChildren) terminateChild(child, signal);
}
